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
const { namedNode, literal, quad, defaultGraph } = N3.DataFactory
const uuid = require('uuid')
const nunjucks = require('nunjucks')

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
  qudt: 'http://qudt.org/schema/qudt/',
  unit: 'http://qudt.org/vocab/unit/',
  fmi: 'https://ontologies.msaas.me/fmi-ontology.ttl#',
  sms: 'https://ontologies.msaas.me/sms-ontology.ttl#',
  api: 'http://localhost:4000/vocabulary#' // TODO do not hardcode origin!
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
class Resource {
  iri // the Internationalized Resource Identifier of this resource

  constructor () {
    if (this.constructor === Resource) {
      throw new Error('Abstract classes can not be instantiated!')
    }
  }

  asJSON () {
    throw new Error('Method `asJSON` must be implemented.')
  }

  asRDF () {
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
      }
    }

    // WIP Add metadata/context/controls before adding actual data
    parts.model.store.addQuads([
      quad(
        namedNode(`#context`),
        ns.foaf.primaryTopic,
        namedNode(modelURI),
        namedNode(`#context`)
      ),
      quad(namedNode(`#context`), ns.api.home, namedNode('/'), namedNode(`#context`)),
      quad(
        namedNode('#context'),
        ns.api.allInstances,
        namedNode('#controls-get-instances'),
        namedNode(`#context`)
      ),
      quad(
        namedNode('#controls-get-instances'),
        ns.rdf.type,
        ns.http.Request,
        namedNode('#controls')
      ),
      quad(
        namedNode('#controls-get-instances'),
        ns.http.methodName,
        literal('GET'),
        namedNode('#controls')
      ),
      quad(
        namedNode('#controls-get-instances'),
        ns.http.requestURI,
        namedNode(`${modelURI}/instances`),
        namedNode('#controls')
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
      })

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
      _.forEach(serializations, async function (config, mimetype) {
        const filePath = `${modelDirectory}/${resource}.${config.extension}`
        filePaths[resource][mimetype] = filePath

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
    const origin = `${request.protocol}://${request.headers.host}`

    // Extract `modelDescription.xml` from FMU
    const tmpDir = path.dirname(tmpFile)
    await extract(tmpFile, { dir: tmpDir })

    // Have worker build internal representation of model
    const modelDescription = await fs.readFile(`${tmpDir}/modelDescription.xml`)
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
      iri_prefix: `${origin}/models`
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
      modelViewWorker.guid
    )

    filePaths.model['application/octet-stream'] = modelFilePath

    // Call actual synchronous `constructor` and return resulting object
    return new Model(origin, modelViewWorker, filePaths)
  }

  static async fromJSON (origin, object) {
    const modelView = _.pick(object, ['iri', 'origin', 'graph', 'schemata'])
    modelView.guid = object.id
    modelView.modelName = object.name
    const filePaths = _.pick(object, ['model', 'types', 'variables', 'units'])

    // Call actual synchronous `constructor` and return resulting object
    return new Model(origin, modelView, filePaths)
  }

  async asJSON () {
    return this.json
  }

  async asRDF (mimetype) {
    let reader = fs.readFile
    switch (mimetype) {
      case 'application/ld+json':
        reader = fs.readJSON
        break
      case 'application/trig':
        reader = fs.readFile
        break
      default:
        throw new Error(`Mimetype '${mimetype}' not supported!`)
    }

    return await reader(this.model[mimetype], { encoding: 'utf-8' })
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

  static async init (model, content, mimetype) {
    const view = {}
    view.id = uuid.v4()
    view.iri = `${model.iri}/instances/${view.id}`

    if (mimetype === 'application/json') {
      view.json = content

      log.warn(`Populating internal RDF-representation of instances not implemented!
      -> downstream actions that should be supported will fail in anything but JSON`)
      view.store = null // TODO should theoretically also be populated!
    } else {
      // Parse request body
      let inputStream = null
      let streamParser = null

      if (mimetype === 'application/ld+json') {
        inputStream = Readable.from(JSON.stringify(content))
        streamParser = new JsonLdParser()
      } else {
        // Hope that we deal with a serialization that N3 can handle...
        inputStream = Readable.from(content.toString())
        streamParser = new N3.StreamParser({ baseIRI: view.iri, format: mimetype })
      }

      inputStream.pipe(streamParser)
      const store = await storeStream(streamParser)

      // Add additional triples that are data
      store.addQuads([
        quad(namedNode(view.iri), ns.rdf.type, ns.sms.ModelInstance),
        quad(
          namedNode(view.iri),
          ns.sms.hasSimulationParameters,
          namedNode('#shapes-simulation-parameters'),
          defaultGraph()
        )
      ])

      // Add metadata
      const metadataGraph = namedNode('#metadata')

      // Define the context of this resource
      const contextGraph = namedNode('#context')
      store.addQuads([
        quad(
          namedNode('#context'),
          ns.foaf.primaryTopic,
          namedNode(view.iri),
          contextGraph
        ),
        quad(namedNode('#context'), ns.api.home, namedNode(model.origin), contextGraph),
        quad(
          namedNode('#context'),
          ns.api.allSimulations,
          namedNode(`${view.iri}/experiments`),
          contextGraph
        )
      ])

      // Define the controls that this resource supports
      const controlsGraph = namedNode('#controls')

      // Define the necessary shapes
      const shapesGraph = namedNode('#shapes')
      store.addQuad(
        quad(
          namedNode('#shapes-simulation-parameters'),
          ns.rdf.type,
          ns.sh.NodeShape,
          shapesGraph
        )
      )

      // Collect all information in view that is passed to the actual constructor
      view.graph = store
      view.json = null // private attribute; only populated when user supplies JSON
    }

    return new ModelInstance(model, view)
  }

  async asJSON () {
    let parametersAsJSON = {}

    if (this.graph === undefined) {
      parametersAsJSON = this.json.parameters
    } else {
      const unitMap = {
        m: `${knownPrefixes.unit}M`,
        m2: `${knownPrefixes.unit}M2`,
        deg: `${knownPrefixes.unit}DEG`
      }

      _.forEach(
        this.graph.getSubjects(ns.sms.isParameterValueFor, null, defaultGraph()),
        (subject) => {
          const obj = { value: null, unit: '1' }
          _.forEach(
            this.graph.getQuads(subject.value, null, null, defaultGraph()),
            (quad) => {
              if (quad.predicate.value === `${knownPrefixes.qudt}numericValue`) {
                obj.value = parseFloat(quad.object.value) // TODO account for datatype?
              }
              if (quad.predicate.value === `${knownPrefixes.qudt}unit`) {
                obj.unit = _.findKey(unitMap, function (o) {
                  return o === quad.object.value
                })
              }
              const key = _.last(_.split(quad.subject.value, '#'))
              parametersAsJSON[key] = obj
            }
          )
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

  async asRDF (mimetype) {
    const supportedMimeTypes = ['application/trig', 'application/ld+json']
    let representation

    if (_.includes(supportedMimeTypes, mimetype)) {
      if (mimetype === 'application/trig') {
        const streamWriter = new N3.StreamWriter({
          format: 'application/trig',
          prefixes: { '': `${this.iri}#`, ...knownPrefixes }
        })
        this.graph.match(null, null, null).pipe(streamWriter)
        representation = await readableToString(streamWriter)
      }
      if (mimetype === 'application/ld+json') {
        const streamWriter = new JsonLdSerializer({
          space: '  ',
          context: knownPrefixes
        })
        this.graph.match(null, null, null).pipe(streamWriter)
        representation = await readableToString(streamWriter)
        representation = JSON.parse(representation)
      }

      return representation
    } else {
      throw new Error(`Mimetype '${mimetype}' not supported!`)
    }
  }
}

class Simulation extends Resource {
  constructor (instance, simulationView) {
    super()

    this.id = uuid.v4()
    this.iri = `${instance.iri}/experiments/${this.id}`
    this.origin = instance.origin
    this.instance = instance

    this.json = simulationView.json
  }

  static async init (instance, content, mimetype) {
    const simulationView = {}

    if (mimetype === 'application/json') {
      simulationView.json = content
    } else {
      simulationView.json = await fs.readJSON(
        'test/data/6157f34f-f629-484b-b873-f31be22269e1/simulation.json'
      )
    }

    return new Simulation(instance, simulationView)
  }

  async asTask () {
    const instanceRepresentation = await this.instance.asJSON()
    return {
      modelInstanceId: this.instance.id,
      simulationParameters: this.json.simulationParameters,
      inputTimeseries: this.json.inputTimeseries,
      parameterSet: instanceRepresentation.parameters,
      modelHref: this.instance.model.iri
    }
  }

  async asJSON () {
    return this.json
  }

  async asRDF (mimetype) {
    if (mimetype === 'application/trig') {
      const representation = nunjucks.render('resources/simulation.trig.jinja', {
        fmi_url: knownPrefixes.fmi,
        sms_url: knownPrefixes.sms,
        api_url: `${this.origin}/vocabulary#`,
        base_url: this.iri,
        base_separator: '/'
      })

      return representation
    } else {
      throw new Error(`Mimetype '${mimetype}' not yet implemented!`)
    }
  }
}

class SimulationResult extends Resource {
  constructor (simulation, resultView) {
    super()

    this.iri = `${simulation.iri}/result`
    this.origin = simulation.origin

    this.simulation = simulation

    this.json = resultView
  }

  static async init (simulation, result) {
    const resultView = result

    return new SimulationResult(simulation, resultView)
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

  async asRDF (mimetype) {
    if (mimetype === 'application/trig') {
      const representation = nunjucks.render('resources/simulation_result.trig.jinja', {
        api_url: `${this.origin}/vocabulary#`,
        base_url: this.iri,
        sms_url: knownPrefixes.sms,
        simulation_url: this.simulation.iri,
        observations: '/behaviour/quantity/observations',
        feature_of_interest: '/behaviour',
        property: '/behaviour/quantity'
      })

      return representation
    } else {
      throw new Error(`Mimetype '${mimetype}' not yet implemented!`)
    }
  }
}

exports.knownPrefixes = knownPrefixes
exports.Model = Model
exports.ModelInstance = ModelInstance
exports.Simulation = Simulation
exports.SimulationResult = SimulationResult
