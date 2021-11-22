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
const { namedNode, literal, quad } = N3.DataFactory
const uuid = require('uuid')
const nunjucks = require('nunjucks')

// Helper classes/-functions
const knownPrefixes = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/spec/#',
  hydra: 'http://www.w3.org/ns/hydra/core#',
  http: 'http://www.w3.org/2011/http#',
  fmi: 'https://ontologies.msaas.me/fmi-ontology.ttl#',
  sms: 'https://ontologies.msaas.me/sms-ontology.ttl#',
  api: 'http://localhost:4000/vocabulary#' // TODO do not hardcode origin!
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
    this.name = modelView.name
    this.iri = `${origin}${Model.iriPathAllModels}/${this.id}`

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
    const ns = _.mapValues(knownPrefixes, function (o) {
      return namespace(o)
    })

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
      quad(
        namedNode(`#context`),
        ns.api.home,
        namedNode(_.join(_.slice(_.split(modelURI, '/'), 0, 3), '/')),
        namedNode(`#context`)
      ),
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
    const modelView = _.pick(object, ['id', 'name', 'iri', 'graph', 'schemata'])
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
  constructor (modelIRI, instanceView) {
    super()

    this.id = uuid.v4()
    this.iri = `${modelIRI}/instances/${this.id}`
    this.origin = new URL(modelIRI).origin

    this.json = instanceView.json
    this.data = instanceView.store
    this.metadata = null
    this.context = null
    this.controls = null
  }

  static async init (modelIRI, content, mimetype) {
    const instanceView = {}

    if (mimetype === 'application/json') {
      instanceView.json = {
        model: {
          href: modelIRI,
          id: _.last(_.split(modelIRI, '/'))
        },
        parameterSet: content.parameters
      }

      instanceView.store = null // TODO should theoretically also be populated!
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
        streamParser = new N3.StreamParser({ format: mimetype })
      }

      inputStream.pipe(streamParser)
      const store = await storeStream(streamParser)

      instanceView.store = store
      instanceView.json = {} // TODO should be populated from the store eventually
    }

    return new ModelInstance(modelIRI, instanceView)
  }

  async asJSON () {
    return {
      modelId: this.json.model.id,
      modelHref: this.json.model.href,
      parameters: this.json.parameterSet
    }
  }

  async asRDF (mimetype) {
    if (mimetype === 'application/trig') {
      const representation = nunjucks.render('resources/model_instance.trig.jinja', {
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

exports.knownPrefixes = knownPrefixes
exports.Model = Model
exports.ModelInstance = ModelInstance
