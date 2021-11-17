// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

// Load modules
const _ = require('lodash')
const fs = require('fs-extra')
const path = require('path')
const uuid = require('uuid')
const celery = require('celery-ts')
const extract = require('extract-zip')
const NodeCache = require('node-cache')
const { promiseStatus } = require('promise-status-async')
const { OpenAPIBackend } = require('openapi-backend')
const $RefParser = require('@apidevtools/json-schema-ref-parser')
const N3 = require('n3')
const namespace = require('@rdfjs/namespace')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const storeStream = require('rdf-store-stream').storeStream
const JsonLdParser = require('jsonld-streaming-parser').JsonLdParser
const JsonLdSerializer = require('jsonld-streaming-serializer').JsonLdSerializer
const { namedNode, literal, defaultGraph, quad } = N3.DataFactory

const log = require('./logger.js')
const responseUtils = require('./response_utils.js')

// Use global objects as datastore
const cfg = {
  oas: {
    filePathStatic: './templates/simaas_oas3.json',
    templates: {
      parameter: './templates/oas/parameters.json.jinja',
      io: './templates/oas/inputs_outputs.json.jinja'
    }
  },
  tmpfs: process.env.SIMAAS_TMPFS_PATH,
  fs: process.env.SIMAAS_FS_PATH,
  backingServices: {
    rabbitMQ: {
      protocol: 'amqp',
      hostname: process.env.SIMAAS_RABBITMQ_HOSTNAME,
      username: process.env.SIMAAS_RABBITMQ_USERNAME,
      password: process.env.SIMAAS_RABBITMQ_PASSWORD
    },
    redis: {
      protocol: 'redis',
      hostname: process.env.SIMAAS_REDIS_HOSTNAME
    }
  }
}

cfg.oas.filePathDynamic = `${cfg.fs}/OAS.json`

const modelInstanceCache = new NodeCache({
  // TODO make configurable?
  stdTTL: 3600,
  checkperiod: 3900,
  deleteOnExpire: true
})
const knownModelInstances = []
const experimentCache = new NodeCache({
  // TODO make configurable?
  stdTTL: 240,
  checkperiod: 600,
  deleteOnExpire: true
})
const jobQueue = {}

const knownPrefixes = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dct: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/spec/#',
  hydra: 'http://www.w3.org/ns/hydra/core#',
  fmi: 'https://ontologies.msaas.me/fmi-ontology.ttl#',
  sms: 'https://ontologies.msaas.me/sms-ontology.ttl#'
}

const ns = _.mapValues(knownPrefixes, function (o) {
  return namespace(o)
})

// Helper function to read/add/delete key/value-pair in JSON-file
async function updatePartOfJsonFile (file, path, key, value, action) {
  const fileContent = await fs.readJson(file)
  let position
  if (path !== null) {
    position = _.concat(path, key)
  } else {
    position = [key]
  }

  switch (action) {
    case 'set':
      _.set(fileContent, position, value)
      break
    case 'delete':
      _.unset(fileContent, position)
      break
    default:
      return fileContent
  }

  await fs.writeJson(file, fileContent, { spaces: 2 })
  return fileContent
}

// Use .json-file on disk as persistent storage for model representations
async function updateInternalListOfModels (key, value, action) {
  const modelRepresentationsFilePath = `${cfg.fs}/modelRepresentations.json`
  const exists = await fs.pathExists(modelRepresentationsFilePath)

  if (exists === false) {
    await fs.writeJson(modelRepresentationsFilePath, {})
  }

  const fileContent = await updatePartOfJsonFile(
    modelRepresentationsFilePath,
    null,
    key,
    value,
    action
  )
  return fileContent
}

async function updateOpenAPISpecification (key, value, action) {
  const OAS = cfg.oas.filePathDynamic
  const exists = await fs.pathExists(OAS)

  if (exists === false) {
    await fs.copy(cfg.oas.filePathStatic, OAS)
  }

  const fileContent = await updatePartOfJsonFile(
    OAS,
    ['components', 'schemas'],
    key,
    value,
    action
  )
  return fileContent
}

// Instantiate connections to messaging broker and result storage
// TODO handle attempts to connect to non-available backends gracefully!
const options = {
  hostname: cfg.backingServices.rabbitMQ.hostname,
  protocol: cfg.backingServices.rabbitMQ.protocol,
  username: cfg.backingServices.rabbitMQ.username,
  password: cfg.backingServices.rabbitMQ.password,
  frameMax: 0
}
const broker = new celery.AmqpBroker(options)
const brokers = [broker]
const backend = celery.createBackend(
  uuid.v4(),
  `${cfg.backingServices.redis.protocol}://${cfg.backingServices.redis.hostname}`
)

// https://node-celery-ts.github.io/node-celery-ts/globals.html#default_config
const celeryClient = new celery.Client({
  backend,
  brokers
})

// Implement functionality
async function createModelRepresentationRDF (input, modelDirectory, modelURI) {
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

// Define handlers
function initializeBackend (oasFilePath) {
  let backend = null
  try {
    backend = new OpenAPIBackend({
      definition: oasFilePath,
      strict: true,
      validate: true,
      validateFormats: false
    })
    log.info(`successfully loaded API description ${oasFilePath}`)
  } catch (error) {
    log.fatal(`error while loading API description ${oasFilePath}`)
    process.exit(5)
  }

  backend.init()

  // Define routing
  backend.register('addModel', addModel)
  backend.register('getModel', getModel)
  backend.register('deleteModel', deleteModel)
  backend.register('createModelInstance', createModelInstance)
  backend.register('getModelInstance', getModelInstance)
  backend.register('triggerSimulation', simulateModelInstance)
  backend.register('getExperiment', getExperimentStatus)
  backend.register('getExperimentResult', getExperimentResult)
  backend.register('getOAS', serveOAS)

  // Handle unsuccessful requests
  backend.register('validationFail', responseUtils.failValidation)
  backend.register('notImplemented', responseUtils.respondWithNotImplemented)
  backend.register('notFound', responseUtils.respondWithNotFound)

  return backend
}

async function getApiRoot (req, res ) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  res.format({
    'application/trig': function () {
      res.status(200).render('resources/home.trig.jinja', {
        base_url: thisURL,
        base_separator: '', // `thisURL` already includes the `/` here
        api_url: `${origin}/vocabulary#`,
        path_ui: cfg.oas.path.ui
      })
    }
  })
}

async function getApiVocabulary (req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  res.format({
    'application/trig': function () {
      res.status(200).render('resources/vocabulary.trig.jinja', {
        base_url: thisURL,
        base_separator: '#'
      })
    }
  })
}

async function getModelCollection (req, res) {
async function addModel (c, req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const allModelsURL = `${origin}/models`

  // Receive file content
  const tmpDir = `${cfg.tmpfs}/${uuid.v4()}`
  const tmpFile = `${tmpDir}/${req.files.fmu.name}`
  await fs.ensureDir(tmpDir)
  await fs.writeFile(tmpFile, req.files.fmu.data)

  // Extract modelDescription.xml from archive
  await extract(tmpFile, { dir: tmpDir })

  // Have worker build internal representation of model
  const modelDescription = await fs.readFile(`${tmpDir}/modelDescription.xml`)
  const templateParameters = await fs.readFile(cfg.oas.templates.parameter)
  const templateIO = await fs.readFile(cfg.oas.templates.io)

  // FIXME buffer too small iff task representation > 2**15 bytes!
  const stringEncoding = 'utf8'
  const taskRepresentation = {
    modelDescription: modelDescription.toString(stringEncoding),
    templates: {
      parameter: templateParameters.toString(stringEncoding),
      io: templateIO.toString(stringEncoding)
    },
    records: _.split(req.query.records, ','),
    iri_prefix: allModelsURL
  }

  const task = celeryClient.createTask('worker.tasks.get_modelinfo')
  const job = task.applyAsync({
    args: [taskRepresentation],
    compression: celery.Compressor.Zlib,
    kwargs: {}
  })

  const modelInfo = await job.get()

  // Include model in internal list of models
  const modelRepresentation = JSON.parse(modelInfo)
  const modelId = modelRepresentation.guid
  const modelURI = `${allModelsURL}/${modelId}`

  // Store file persistently iff it doesn't exist already
  const modelDirectory = `${cfg.fs}/models/${modelId}`
  const modelFilePath = _.replace(tmpFile, tmpDir, modelDirectory)
  const modelFilePathExists = await fs.pathExists(modelFilePath)

  if (!modelFilePathExists) {
    await fs.ensureDir(modelDirectory)
    await fs.move(tmpFile, modelFilePath)
  }

  // Create RDF resource representations for model and its types, units and variables
  const filePaths = await createModelRepresentationRDF(
    modelRepresentation.graph,
    modelDirectory,
    modelURI
  )

  // Persist changes to internal list of models
  modelRepresentation.parts = filePaths
  modelRepresentation.parts.model['application/octet-stream'] = modelFilePath
  await updateInternalListOfModels(modelId, modelRepresentation, 'set')

  // Clean up temporary files/directories
  // -- obviously doesn't work if the API crashes before reaching this...
  await fs.remove(tmpDir)

  // Add schemata for parameters/inputs/outputs to OAS
  await updateOpenAPISpecification(
    modelRepresentation.modelName,
    modelRepresentation.schemata.parameter,
    'set'
  )
  await updateOpenAPISpecification(
    modelRepresentation.guid,
    modelRepresentation.schemata.input,
    'set'
  )

  // Restart backend
  c.api = initializeBackend(cfg.oas.filePathDynamic) // hope this works... it does!

  // Return 201 pointing to resource exposing the model
  res.format({
    'application/trig': function () {
      res
        .status(201)
        .location(modelURI)
        .render('responses/add_model.trig.jinja', { model: modelURI })
    },

    'application/json': function () {
      res
        .status(201)
        .location(modelURI)
        .json()
    }
  })
}

async function getModel (c, req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')

  const modelRepresentation = listOfModels[modelId]
  const fmuFilePath = modelRepresentation.parts.model['application/octet-stream']
  const modelRepresentationJson = _.pick(modelRepresentation, [
    'modelName',
    'description',
    'fmiVersion',
    'generationTool',
    'generationDateAndTime'
  ])
  const modelRepresentationTriG = await fs.readFile(
    modelRepresentation.parts.model['application/trig'],
    { encoding: 'utf-8' }
  )
  const modelRepresentationJsonLd = await fs.readJSON(
    modelRepresentation.parts.model['application/ld+json'],
    { encoding: 'utf-8' }
  )

  res.format({
    'application/trig': function () {
      res.status(200).send(modelRepresentationTriG)
    },

    'application/ld+json': function () {
      res.status(200).json(modelRepresentationJsonLd)
    },

    'application/json': function () {
      res.status(200).json(modelRepresentationJson)
    },

    'application/octet-stream': async function () {
      const fileContent = await fs.readFile(fmuFilePath)
      res.status(200).send(fileContent)
    },

    default: responseUtils.respondWithNotFound
  })
}

async function getModelTypes (req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const modelTypes = listOfModels[modelId].parts.types
  const modelTypesTriG = await fs.readFile(modelTypes['application/trig'], {
    encoding: 'utf-8'
  })
  const modelTypesJsonLd = await fs.readJSON(modelTypes['application/ld+json'])

  res.format({
    'application/trig': function () {
      res.status(200).send(modelTypesTriG)
    },
    'application/ld+json': function () {
      res.status(200).json(modelTypesJsonLd)
    }
  })
}

async function getModelUnits (req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const modelUnits = listOfModels[modelId].parts.units
  const modelUnitsTriG = await fs.readFile(modelUnits['application/trig'], {
    encoding: 'utf-8'
  })
  const modelUnitsJsonLd = await fs.readJSON(modelUnits['application/ld+json'])

  res.format({
    'application/trig': function () {
      res.status(200).send(modelUnitsTriG)
    },
    'application/ld+json': function () {
      res.status(200).json(modelUnitsJsonLd)
    }
  })
}

async function getModelVariables (req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const modelVariables = listOfModels[modelId].parts.variables
  const modelVariablesTriG = await fs.readFile(modelVariables['application/trig'], {
    encoding: 'utf-8'
  })
  const modelVariablesJsonLd = await fs.readJSON(modelVariables['application/ld+json'])

  res.format({
    'application/trig': function () {
      res.status(200).send(modelVariablesTriG)
    },
    'application/ld+json': function () {
      res.status(200).json(modelVariablesJsonLd)
    }
  })
}

async function deleteModel (c, req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')

  const fmuFilePath = listOfModels[modelId].parts.model['application/octet-stream']
  const modelDirectory = path.dirname(fmuFilePath)
  const modelName = listOfModels[modelId].modelName

  // Update OAS and re-initialize backend
  await updateOpenAPISpecification(modelName, null, 'delete')
  await updateOpenAPISpecification(modelId, null, 'delete')
  c.api = initializeBackend(cfg.oas.filePathDynamic)

  // Delete internal model representation
  await updateInternalListOfModels(modelId, null, 'delete')

  // Delete files from disk
  await fs.remove(modelDirectory)

  // Send response
  res.status(204).send()
}

async function createModelInstance (c, req, res) {
  const requestBody = _.get(req, ['body'])

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  const modelId = _.nth(_.split(req.path, '/'), 2)
  const modelInstanceId = uuid.v4()

  // Create internal representation of new model instance
  modelInstanceCache.set(modelInstanceId, {
    model: {
      href: `${origin}/models/${modelId}`,
      id: modelId
    },
    parameterSet: requestBody.parameters // XXX assumes JSON-body
  })
  knownModelInstances.push(modelInstanceId)

  // Immediately return `201 Created` with corresponding `Location`-header
  res.set('Content-Type', 'application/json')
  res
    .status(201)
    .location(`${origin}/models/${modelId}/instances/${modelInstanceId}`)
    .json()
}

async function getModelInstance (c, req, res) {
  const modelInstanceId = _.last(_.split(req.url, '/'))
  const modelInstance = modelInstanceCache.get(modelInstanceId)

  if (modelInstance === undefined) {
    if (_.includes(knownModelInstances, modelInstanceId)) {
      await responseUtils.respondWithGone(c, req, res)
    } else {
      await responseUtils.respondWithNotFound(c, req, res)
    }
  } else {
    res.status(200).json({
      modelId: modelInstance.model.id,
      modelHref: modelInstance.model.href,
      parameters: modelInstance.parameterSet
    })
    req.log.info(
      { res: res },
      `successfully handled ${req.method}-request on ${req.path}`
    )
  }
}

async function simulateModelInstance (c, req, res) {
  const requestBody = _.get(req, ['body'])

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  // Amend request body with additional required information to build task signature
  const modelInstanceId = _.nth(_.split(req.path, '/'), 4)
  const modelInstance = modelInstanceCache.get(modelInstanceId)
  const taskRepresentation = {
    modelInstanceId: modelInstanceId,
    simulationParameters: requestBody.simulationParameters,
    inputTimeseries: requestBody.inputTimeseries,
    parameterSet: modelInstance.parameterSet,
    modelHref: modelInstance.model.href,
    requestId: req.id
  }

  // Enqueue request
  const task = celeryClient.createTask('worker.tasks.simulate')
  const job = task.applyAsync({
    args: [taskRepresentation],
    kwargs: {}
  })

  // Store experiment setup identified by UUID
  const experimentId = job.taskId
  jobQueue[experimentId] = job
  experimentCache.set(experimentId, {
    setup: requestBody, // XXX assumes JSON-body
    simulationResult: null
  })

  // Immediately return `201 Created` with corresponding `Location`-header
  res.set('Content-Type', 'application/json')
  res
    .status(201)
    .location(
      `${origin}/models/${requestBody.modelId}/instances/${modelInstanceId}/experiments/${experimentId}`
    )
    .json()
}

async function getExperimentStatus (c, req, res) {
  const experimentId = _.last(_.split(req.url, '/'))

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  const experimentRepresentationInternal = experimentCache.get(experimentId)

  if (experimentRepresentationInternal === undefined) {
    if (_.has(jobQueue, experimentId)) {
      await responseUtils.respondWithGone(c, req, res)
    } else {
      await responseUtils.respondWithNotFound(c, req, res)
    }
  } else {
    const setup = { ...experimentRepresentationInternal.setup }
    const job = jobQueue[experimentId]
    let jobStatus
    let simulationResult
    const promise = job.result
    if ((await promiseStatus(promise)) === 'resolved') {
      jobStatus = 'SUCCESS'
      simulationResult = await job.get()
      delete jobQueue.experimentId
    } else if ((await promiseStatus(promise)) === 'rejected') {
      jobStatus = 'FAILURE'
      delete jobQueue.experimentId
    } else {
      jobStatus = 'PENDING'
    }

    const statusMapping = {
      PENDING: 'NEW',
      STARTED: 'IN_PROGRESS',
      SUCCESS: 'DONE',
      FAILURE: 'FAILED'
    }
    const status = statusMapping[jobStatus]

    setup.status = status

    if (status === 'DONE') {
      setup.linkToResult = `${origin}/${req.url}/result`
      experimentCache.set(experimentId, {
        setup: setup,
        simulationResult: simulationResult
      })
    }

    res.status(200).json(setup)
    req.log.info(
      { res: res },
      `successfully handled ${req.method}-request on ${req.path}`
    )
  }
}

async function getExperimentResult (c, req, res) {
  const experimentId = _.nth(_.split(req.url, '/'), -2)

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  const experimentRepresentationInternal = experimentCache.get(experimentId)

  if (experimentRepresentationInternal === undefined) {
    if (_.has(jobQueue, experimentId)) {
      await responseUtils.respondWithGone(c, req, res)
    } else {
      await responseUtils.respondWithNotFound(c, req, res)
    }
  } else {
    const modelInstanceId = _.get(experimentRepresentationInternal, [
      'setup',
      'modelInstanceId'
    ])
    const startTime = _.get(experimentRepresentationInternal, [
      'setup',
      'simulationParameters',
      'startTime'
    ])
    const stopTime = _.get(experimentRepresentationInternal, [
      'setup',
      'simulationParameters',
      'stopTime'
    ])

    // Transform body to specified format
    const resultBody = {
      description: `The results of simulating model instance ${origin}/model-instances/${modelInstanceId} from ${startTime} to ${stopTime} as specified in ${origin}/experiments/${experimentId}`,
      data: experimentRepresentationInternal.simulationResult
    }

    res.status(200).json(resultBody)
    req.log.info(
      { res: res },
      `successfully handled ${req.method}-request on ${req.path}`
    )
  }
}

async function serveOAS (c, req, res) {
  const oas = await updateOpenAPISpecification(null, null, 'read')
  const parse$ref = req.query.parse$ref

  let oasRepresentation = null
  switch (parse$ref) {
    case 'bundle':
      oasRepresentation = await $RefParser.bundle(oas)
      break
    case 'flatten':
      oasRepresentation = await $RefParser.dereference(oas)
      break
    default:
      oasRepresentation = oas
  }

  res.status(200).json(oasRepresentation)
}

// Export handlers
exports.updateInternalListOfModels = updateInternalListOfModels
exports.updateOpenAPISpecification = updateOpenAPISpecification
exports.initializeBackend = initializeBackend
exports.getApiRoot = getApiRoot
exports.getApiVocabulary = getApiVocabulary
exports.addModel = addModel
exports.getModel = getModel
exports.getModelTypes = getModelTypes
exports.getModelUnits = getModelUnits
exports.getModelVariables = getModelVariables
exports.deleteModel = deleteModel
exports.createModelInstance = createModelInstance
exports.getModelInstance = getModelInstance
exports.simulateModelInstance = simulateModelInstance
exports.getExperimentStatus = getExperimentStatus
exports.getExperimentResult = getExperimentResult
exports.serveOAS = serveOAS
