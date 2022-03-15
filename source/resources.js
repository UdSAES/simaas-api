// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

// Load modules
const _ = require('lodash')
const path = require('path')
const fs = require('fs-extra')
const extract = require('extract-zip')
const celery = require('celery-ts')
const N3 = require('n3')
const namespace = require('@rdfjs/namespace')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const storeStream = require('rdf-store-stream').storeStream
const JsonLdParser = require('jsonld-streaming-parser').JsonLdParser
const JsonLdSerializer = require('jsonld-streaming-serializer').JsonLdSerializer
const { namedNode, blankNode, quad, defaultGraph } = N3.DataFactory
const uuid = require('uuid')
const moment = require('moment')

const log = require('./logger.js')

// Helper classes/-functions
const knownPrefixes = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/spec/#',
  hydra: 'http://www.w3.org/ns/hydra/core#',
  http: 'http://www.w3.org/2011/http#',
  sh: 'http://www.w3.org/ns/shacl#',
  sosa: 'http://www.w3.org/ns/sosa/',
  qudt: 'http://qudt.org/schema/qudt/',
  unit: 'http://qudt.org/vocab/unit/',
  time: 'http://www.w3.org/2006/time#',
  fmi: 'https://purl.org/fmi-ontology#',
  sms: 'https://purl.org/sms-ontology#',
  api: '/vocabulary#'
}

const ns = _.mapValues(knownPrefixes, function (o) {
  return namespace(o)
})

// https://2ality.com/2019/11/nodejs-streams-async-iteration.html
// #collecting-the-contents-of-a-readable-stream-in-a-string
async function readableToString (readable) {
  let result = ''
  for await (const chunk of readable) {
    result += chunk
  }
  return result
}

// Class definitions
class NotAcceptableError extends Error {
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference
  // /Global_Objects/Error#es6_custom_error_class
  constructor (...params) {
    // Pass remaining arguments (including vendor specific ones) to parent constructor
    super(...params)

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NotAcceptableError)
    }

    this.name = 'NotAcceptable'
  }
}

class Resource {
  iri // the Internationalized Resource Identifier of this resource

  constructor () {
    if (this.constructor === Resource) {
      throw new Error('Abstract classes can not be instantiated!')
    }
  }

  static unitMap = {
    m: `${knownPrefixes.unit}M`,
    m2: `${knownPrefixes.unit}M2`,
    deg: `${knownPrefixes.unit}DEG`,
    degC: `${knownPrefixes.unit}DEG_C`,
    'm/s': `${knownPrefixes.unit}M-PER-SEC`,
    s: `${knownPrefixes.unit}SEC`
  }

  static supportedRdfSerializationsN3 = [
    'text/turtle',
    'application/trig',
    'application/n-triples',
    'application/n-quads',
    'text/n3'
  ]

  static supportedRdfSerializations = _.concat(this.supportedRdfSerializationsN3, [
    'application/ld+json'
  ])

  static async parseRdfRequestbody (content, mediatype, baseIRI) {
    // Parse request body
    let inputStream = null
    let streamParser = null

    if (_.includes(this.supportedRdfSerializations, mediatype)) {
      if (mediatype === 'application/ld+json') {
        inputStream = Readable.from(JSON.stringify(content))
        streamParser = new JsonLdParser({ baseIRI: baseIRI })
      } else {
        inputStream = Readable.from(content.toString())
        streamParser = new N3.StreamParser({ baseIRI: baseIRI, format: mediatype })
      }
    } else {
      throw new NotAcceptableError(`Media Type '${mediatype}' not supported`)
    }

    inputStream.pipe(streamParser)
    const store = await storeStream(streamParser)

    return store
  }

  static async renderRdfResponseFromGraph (graph, mediatype, resourceIRI) {
    let representation

    if (_.includes(this.supportedRdfSerializations, mediatype)) {
      if (mediatype === 'application/ld+json') {
        const streamWriter = new JsonLdSerializer({
          space: '  ',
          context: knownPrefixes
        })
        graph.match(null, null, null).pipe(streamWriter)
        representation = await readableToString(streamWriter)
        representation = JSON.parse(representation)
      } else {
        const streamWriter = new N3.StreamWriter({
          format: mediatype,
          prefixes: { '': `${resourceIRI}#`, ...knownPrefixes }
        })
        graph.match(null, null, null).pipe(streamWriter)
        representation = await readableToString(streamWriter)
      }

      return representation
    } else {
      throw new Error(`Media Type '${mediatype}' not supported!`)
    }
  }

  async asJSON () {
    throw new Error('Method `asJSON` must be implemented.')
  }

  async asRDF () {
    throw new Error('Method `asRDF` must be implemented.')
  }
}

class Model extends Resource {
  static templates = {
    parameter: './templates/oas/parameters.json.jinja',
    io: './templates/oas/inputs_outputs.json.jinja'
  }

  static iriPathAllModels = '/models'

  constructor (origin, modelView, filePaths) {
    super()

    this.id = modelView.guid
    this.iri = `${origin}${Model.iriPathAllModels}/${this.id}`
    this.origin = origin

    this.name = modelView.modelName
    this.graph = modelView.graph
    this.json = _.pick(modelView, [
      'modelName',
      'description',
      'fmiVersion',
      'generationTool',
      'generationDateAndTime'
    ])
    this.schemata = modelView.schemata

    this.model = filePaths.model
    this.types = filePaths.types
    this.variables = filePaths.variables
    this.units = filePaths.units
    this.shapes = filePaths.shapes
  }

  static async createRdfRepresentation (input, modelDirectory, modelURI) {
    // Read quads to RDFJS-compatible internal representation; pipe to store
    const inputStream = Readable.from(JSON.stringify(input))
    const streamParser = new JsonLdParser()
    inputStream.pipe(streamParser)
    const store = await storeStream(streamParser)

    // Prepare separation of input graph into constituents
    const parts = {
      model: {
        type: ns.fmi.FMU,
        store: new N3.Store()
      },
      types: {
        type: ns.fmi.SimpleType,
        store: new N3.Store()
      },
      variables: {
        type: ns.fmi.ScalarVariable,
        store: new N3.Store()
      },
      units: {
        type: ns.fmi.Unit,
        store: new N3.Store()
      },
      shapes: {
        type: ns.sh.NodeShape,
        store: new N3.Store()
      }
    }

    // WIP Add metadata/context/controls before adding actual data
    const aboutGraph = namedNode(`#about`)
    parts.model.store.addQuads([
      quad(aboutGraph, ns.foaf.primaryTopic, namedNode(modelURI), aboutGraph),
      quad(namedNode(modelURI), ns.rdf.type, ns.sms.Model, defaultGraph()),
      quad(aboutGraph, ns.api.home, namedNode('/'), aboutGraph),
      quad(
        namedNode(modelURI),
        ns.api.allInstances,
        namedNode(`${modelURI}/instances`),
        aboutGraph
      )
    ])

    // Add relevant data and write results to files
    const filePaths = _.mapValues(parts, function (o) {
      return {}
    })
    _.forEach(parts, async function (config, resource) {
      const subStore = config.store
      const subjects = store.getQuads(null, ns.rdf.type, config.type)

      _.forEach(subjects, function (subjectQuad) {
        const quadsAboutSubject = store.getQuads(subjectQuad.subject, null, null)

        subStore.addQuad(subjectQuad)
        subStore.addQuads(quadsAboutSubject)

        _.forEach(quadsAboutSubject, function (quad) {
          if (quad.predicate.value === ns.sh.property.value) {
            const nestedQuads = store.getQuads(quad.object, null, null)

            subStore.addQuads(nestedQuads)
          }
        })
      })
    })

    const shapesGraph = namedNode('#shapes')
    _.forEach(parts.shapes.store.getQuads(null, null, null), function (quad) {
      parts.model.store.addQuad(quad.subject, quad.predicate, quad.object, shapesGraph)
    })

    parts.model.store.addQuads([
      quad(
        namedNode(modelURI),
        ns.sms.instantiationShape,
        namedNode(`${modelURI}#shapes-instantiation`),
        aboutGraph
      )
    ])

    _.forEach(parts, async function (config, resource) {
      const subStore = config.store

      // Define serializations
      const serializations = {
        'application/trig': {
          streamWriter: new N3.StreamWriter({
            prefixes: knownPrefixes,
            format: 'application/trig'
          }),
          extension: 'trig'
        },
        'application/ld+json': {
          streamWriter: new JsonLdSerializer({ space: '  ', context: knownPrefixes }),
          extension: 'json'
        }
      }

      // Store serializations as files on disk
      _.forEach(serializations, async function (config, mediatype) {
        const filePath = `${modelDirectory}/${resource}.${config.extension}`
        filePaths[resource][mediatype] = filePath

        const outputStream = fs.createWriteStream(filePath)

        // https://stackoverflow.com/a/65938887
        await pipeline(
          subStore.match(null, null, null),
          config.streamWriter,
          outputStream
        )
      })
    })

    return filePaths
  }

  // https://dev.to/somedood/the-proper-way-to-write-async-constructors-in-javascript-1o8c
  static async init (request, tmpFile, targetDir, celeryClient) {
    // TODO this is problematic iff the origin isn't reachable from worker instances
    // e.g. localhost doesn't work when running containerized! => use gateway-IP of network
    const origin = `${request.protocol}://${request.headers.host}`

    // Extract `modelDescription.xml` from FMU
    const tmpDir = path.dirname(tmpFile)
    await extract(tmpFile, { dir: tmpDir })

    // Have worker build internal representation of model
    const modelDescription = await fs.readFile(`${tmpDir}/modelDescription.xml`, {
      encoding: 'utf-8'
    })
    const templateParameters = await fs.readFile(Model.templates.parameter)
    const templateIO = await fs.readFile(Model.templates.io)
    const stringEncoding = 'utf8'

    const taskRepresentation = {
      modelDescription: modelDescription.toString(stringEncoding),
      templates: {
        parameter: templateParameters.toString(stringEncoding),
        io: templateIO.toString(stringEncoding)
      },
      records: _.split(request.query.records, ','),
      iri_prefix: `${origin}${Model.iriPathAllModels}`
    }

    const task = celeryClient.createTask('worker.tasks.get_modelinfo')
    const job = task.applyAsync({
      args: [taskRepresentation],
      compression: celery.Compressor.Zlib,
      kwargs: {}
    })

    // Retrieve view on model generated by worker instance
    const modelViewWorkerStringified = await job.get()
    const modelViewWorker = JSON.parse(modelViewWorkerStringified)

    // Store file persistently iff it doesn't exist already
    const modelDirectory = `${targetDir}/models/${modelViewWorker.guid}`
    const modelFilePath = _.replace(tmpFile, tmpDir, modelDirectory)
    const modelFilePathExists = await fs.pathExists(modelFilePath)

    if (!modelFilePathExists) {
      await fs.ensureDir(modelDirectory)
      await fs.move(tmpFile, modelFilePath)
    }

    // Create RDF resource representations for model/types/variables/units
    const filePaths = await Model.createRdfRepresentation(
      modelViewWorker.graph,
      modelDirectory,
      `${origin}${Model.iriPathAllModels}/${modelViewWorker.guid}`
    )

    filePaths.model['application/octet-stream'] = modelFilePath

    // Call actual synchronous `constructor` and return resulting object
    return new Model(origin, modelViewWorker, filePaths)
  }

  static async fromJSON (origin, object) {
    const modelView = _.pick(object, ['iri', 'origin', 'graph', 'schemata'])
    modelView.guid = object.id
    modelView.modelName = object.name
    const filePaths = _.pick(object, ['model', 'types', 'variables', 'units', 'shapes'])

    // Call actual synchronous `constructor` and return resulting object
    return new Model(origin, modelView, filePaths)
  }

  async asJSON () {
    return this.json
  }

  async asRDF (mediatype) {
    let reader = fs.readFile
    switch (mediatype) {
      case 'application/ld+json':
        reader = fs.readJSON
        break
      case 'application/trig':
        reader = fs.readFile
        break
      default:
        throw new Error(`Media Type '${mediatype}' not supported!`)
    }

    return await reader(this.model[mediatype], { encoding: 'utf-8' })
  }
}

class ModelInstance extends Resource {
  constructor (model, instanceView) {
    super()

    this.id = instanceView.id
    this.iri = instanceView.iri
    this.origin = model.origin
    this.model = model

    this.graph = instanceView.graph // data, metadata, context, controls, shapes
    this.json = instanceView.json // to be removed when graph is single source of truth
  }

  static async init (model, content, mediatype) {
    const view = {}
    view.id = uuid.v4()
    view.iri = `${model.iri}/instances/${view.id}`

    if (mediatype === 'application/json') {
      view.json = content

      log.warn(`Populating internal RDF-representation of instances not implemented!
      -> downstream actions that should be supported will fail in anything but JSON`)
      view.store = null // TODO should theoretically also be populated!
    } else {
      const store = await Resource.parseRdfRequestbody(content, mediatype, view.iri)

      // -> TODO: INPUT VALIDATION!! <-
      // https://github.com/zazuko/rdf-validate-shacl

      // Add additional triples that are data
      const aboutGraph = namedNode('#about')
      store.addQuads([
        quad(namedNode(view.iri), ns.rdf.type, ns.sms.ModelInstance),
        quad(namedNode(view.iri), ns.sms.instanceOf, namedNode(model.iri)),
        quad(
          namedNode(view.iri),
          ns.sms.simulationShape,
          namedNode('#shapes-simulation'),
          aboutGraph
        ),
        quad(aboutGraph, ns.foaf.primaryTopic, namedNode(view.iri), aboutGraph),
        quad(aboutGraph, ns.api.home, namedNode(model.origin), aboutGraph),
        quad(
          namedNode(view.iri),
          ns.api.allSimulations,
          namedNode(`${view.iri}/experiments`),
          aboutGraph
        )
      ])

      // XXX Define the necessary shapes
      const shapesGraph = namedNode('#shapes')
      store.addQuads([
        quad(
          namedNode('#shapes-simulation'),
          ns.rdf.type,
          ns.sh.NodeShape,
          shapesGraph
        ),
        quad(
          namedNode('#shapes-simulation'),
          ns.sh.targetNode,
          blankNode(),
          shapesGraph
        )
      ])

      // Collect all information in view that is passed to the actual constructor
      view.graph = store
      view.json = null // private attribute; only populated when user supplies JSON
    }

    return new ModelInstance(model, view)
  }

  async asJSON () {
    let parametersAsJSON = {}

    if (this.graph == null) {
      parametersAsJSON = this.json.parameters
    } else {
      _.forEach(
        this.graph.getSubjects(ns.sms.isValueFor, null, defaultGraph()),
        (subject) => {
          const key = _.last(
            _.split(this.graph.getObjects(subject, ns.sms.isValueFor)[0].value, '#')
          )
          const obj = { value: null, unit: '1' }
          _.forEach(
            this.graph.getQuads(subject, null, null, defaultGraph()),
            (quad) => {
              if (quad.predicate.value === `${knownPrefixes.qudt}numericValue`) {
                obj.value = parseFloat(quad.object.value) // TODO account for datatype?
              }
              if (quad.predicate.value === `${knownPrefixes.qudt}unit`) {
                obj.unit = _.findKey(Resource.unitMap, function (o) {
                  return o === quad.object.value
                })
              }
            }
          )
          parametersAsJSON[key] = obj
        }
      )
    }

    return {
      modelId: this.model.id,
      modelHref: this.model.iri,
      modelName: this.model.name,
      parameters: parametersAsJSON
    }
  }

  async asRDF (mediatype) {
    return await Resource.renderRdfResponseFromGraph(this.graph, mediatype, this.iri)
  }
}

class Simulation extends Resource {
  constructor (instance, simulationView) {
    super()

    this.id = simulationView.id
    this.iri = simulationView.iri
    this.origin = instance.origin
    this.instance = instance

    this.status = 'NEW'
    this.resultExists = false

    this.graph = simulationView.graph
    this.json = simulationView.json
  }

  static async init (instance, content, mediatype) {
    const view = {}
    view.id = uuid.v4()
    view.iri = `${instance.iri}/experiments/${view.id}`

    if (mediatype === 'application/json') {
      view.json = content

      log.warn(`Populating internal RDF-representation of instances not implemented!
      -> downstream actions that should be supported will fail in anything but JSON`)
      view.store = null // TODO should theoretically also be populated!
    } else {
      const store = await Resource.parseRdfRequestbody(content, mediatype, view.iri)

      // -> TODO: INPUT VALIDATION!! <-

      // Add additional triples that are data
      const aboutGraph = namedNode('#about')
      store.addQuads([
        quad(namedNode(view.iri), ns.rdf.type, ns.sms.Simulation, defaultGraph()),
        quad(
          namedNode(view.iri),
          ns.sms.simulates,
          namedNode(instance.iri),
          defaultGraph()
        ),
        quad(aboutGraph, ns.foaf.primaryTopic, namedNode(view.iri), aboutGraph),
        quad(aboutGraph, ns.api.home, namedNode(instance.origin), aboutGraph)
      ])

      view.graph = store
      view.json = null // private attribute; only populated when user supplies JSON
    }

    return new Simulation(instance, view)
  }

  async asTask () {
    const instanceAsJSON = await this.instance.asJSON()
    const simulationAsJSON = await this.asJSON()
	const internalHref = this.instance.model.iri.replace(
		/^https?:\/\/[^/]*\//g,
		'http://api:3000/'
	)
    return {
      modelInstanceId: this.instance.id,
      simulationParameters: simulationAsJSON.simulationParameters,
      inputTimeseries: simulationAsJSON.inputTimeseries,
      parameterSet: instanceAsJSON.parameters,
      modelHref: internalHref
    }
  }

  async asJSON () {
    let simulationAsJSON = {}

    if (this.graph == null) {
      this.json.status = this.status
      if (this.resultExists === true) {
        this.json.linkToResult = `${this.iri}/result`
      }

      simulationAsJSON = this.json
    } else {
      const simulationParameters = {}
      const inputTimeseries = []

      // Parse simulation parameters
      _.forEach(
        this.graph.getSubjects(ns.sms.isValueFor, null, defaultGraph()),
        (subject) => {
          const parameterName = _.last(
            _.split(
              this.graph.getObjects(subject, ns.sms.isValueFor, null)[0].value,
              '#'
            )
          )
          _.forEach(
            this.graph.getQuads(subject.value, null, null, defaultGraph()),
            (quad) => {
              try {
                simulationParameters[parameterName] = parseFloat(
                  this.graph.getObjects(
                    subject,
                    `${knownPrefixes.qudt}numericValue`,
                    null
                  )[0].value
                )
              } catch (e) {}
              try {
                simulationParameters[parameterName] =
                  this.graph.getObjects(subject, `${knownPrefixes.qudt}value`, null)[0]
                    .value === 'true'
              } catch (e) {}
            }
          )
        }
      )

      simulationAsJSON.simulationParameters = simulationParameters

      // Parse input time series
      _.forEach(
        this.graph.getSubjects(ns.rdf.type, ns.sosa.ObservableProperty, defaultGraph()),
        (observableProperty) => {
          const parameterName = _.last(
            _.split(
              this.graph.getObjects(observableProperty, ns.sms.mappedTo, null)[0].value,
              '#'
            )
          )

          const oneSeries = {
            label: parameterName,
            unit: null,
            timeseries: []
          }

          _.forEach(
            this.graph.getSubjects(
              ns.sosa.observedProperty,
              observableProperty,
              defaultGraph()
            ),
            (observation) => {
              const observationObj = {}

              _.forEach(
                this.graph.getObjects(
                  observation,
                  ns.sosa.hasResult,
                  null,
                  defaultGraph()
                ),
                (result) => {
                  observationObj.value = parseFloat(
                    this.graph.getObjects(
                      result,
                      ns.qudt.numericValue,
                      defaultGraph()
                    )[0].value // XXX breaks if property `sh:numericValue` is missing
                  )
                  if (oneSeries.unit == null) {
                    const qudtUnit = this.graph.getObjects(
                      result,
                      ns.qudt.unit,
                      defaultGraph()
                    )[0].value
                    oneSeries.unit =
                      _.findKey(Resource.unitMap, function (o) {
                        return o === qudtUnit
                      }) || 1
                  }
                }
              )

              _.forEach(
                this.graph.getObjects(
                  observation,
                  ns.sosa.phenomenonTime,
                  null,
                  defaultGraph()
                ),
                (timeInstant) => {
                  observationObj.datetime = this.graph.getObjects(
                    timeInstant,
                    ns.time.inXSDDateTimeStamp,
                    defaultGraph()
                  )[0].value
                }
              )

              observationObj.timestamp = moment(observationObj.datetime).valueOf()
              oneSeries.timeseries.push(observationObj)
            }
          )

          inputTimeseries.push(oneSeries)
        }
      )

      simulationAsJSON.inputTimeseries = inputTimeseries
      simulationAsJSON.modelId = this.instance.model.id
    }

    return simulationAsJSON
  }

  async asRDF (mediatype) {
    if (this.resultExists === true) {
      this.graph.addQuad(
        namedNode(this.iri),
        ns.api.theSimulationResult,
        namedNode(`${this.iri}/result`),
        namedNode('#about')
      )
    }

    return await Resource.renderRdfResponseFromGraph(this.graph, mediatype, this.iri)
  }
}

class SimulationResult extends Resource {
  constructor (simulation, resultView) {
    super()

    this.iri = `${simulation.iri}/result`
    this.origin = simulation.origin

    this.simulation = simulation

    this.graph = resultView.graph
    this.json = resultView.json
  }

  static async init (simulation, result) {
    const view = {}
    view.iri = `${simulation.iri}/result`

    // Load JSON-representation
    view.json = result.json

    // Load RDF-representation
//     const store = await Resource.parseRdfRequestbody(
//       result['ld+json'],
//       'application/ld+json',
//       view.iri
//     )

    // -> TODO: INPUT VALIDATION!! <-

    // Add additional triples that are data
    const aboutGraph = namedNode('#about')
//     store.addQuads([
//       quad(namedNode(view.iri), ns.rdf.type, ns.sms.SimulationResult, defaultGraph()),
//       quad(namedNode(view.iri), ns.sms.resultOf, simulation.iri, defaultGraph()),
//       quad(aboutGraph, ns.foaf.primaryTopic, namedNode(view.iri), aboutGraph),
//       quad(aboutGraph, ns.api.home, namedNode(simulation.origin), aboutGraph)
//     ])

//     view.graph = store
    view.graph = null

    return new SimulationResult(simulation, view)
  }

  async asJSON () {
    const simulationAsJSON = await this.simulation.asJSON()
    const startTime = _.get(simulationAsJSON, ['simulationParameters', 'startTime'])
    const stopTime = _.get(simulationAsJSON, ['simulationParameters', 'stopTime'])

    // Transform body to specified format
    const resultBody = {
      description: `The results of simulating model instance 
      ${this.simulation.instance.iri} from ${startTime} to ${stopTime} as specified in 
      ${this.simulation.iri}`,
      data: this.json
    }

    return resultBody
  }

  async asRDF (mediatype) {
    return await Resource.renderRdfResponseFromGraph(this.graph, mediatype, this.iri)
  }
}

exports.knownPrefixes = knownPrefixes
exports.Model = Model
exports.ModelInstance = ModelInstance
exports.Simulation = Simulation
exports.SimulationResult = SimulationResult
