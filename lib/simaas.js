'use strict'

// Load modules
const _ = require('lodash')
const fs = require('fs-extra')
const uuid = require('uuid')
const celery = require('celery-ts')
const extract = require('extract-zip')
const NodeCache = require('node-cache')
const { promiseStatus } = require('promise-status-async')
const { OpenAPIBackend } = require('openapi-backend')

const log = require('./logger.js')
const responseUtils = require('./response_utils.js')

// Use global objects as datastore
const cfg = {
  oas: {
    filePathStatic: './oas/simaas_oas3.json',
    templates: {
      parameter: './oas/templates/parameters.json.jinja',
      io: './oas/templates/inputs_outputs.json.jinja'
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

const celeryClient = new celery.Client({
  backend,
  brokers
})

// Define handlers
function initializeBackend (oasFilePath) {
  let backend = null
  try {
    backend = new OpenAPIBackend({
      definition: oasFilePath,
      strict: true,
      validate: true,
      ajvOpts: {
        format: false
      }
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
  backend.register('createModelInstance', createModelInstance)
  backend.register('getModelInstance', getModelInstance)
  backend.register('triggerSimulation', simulateModelInstance)
  backend.register('getExperiment', getExperimentStatus)
  backend.register('getExperimentResult', getExperimentResult)
  backend.register('getOAS', responseUtils.serveOAS)

  // Handle unsuccessful requests
  backend.register('validationFail', responseUtils.failValidation)
  backend.register('notImplemented', responseUtils.respondWithNotImplemented)
  backend.register('notFound', responseUtils.respondWithNotFound)

  return backend
}

async function addModel (c, req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

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

  const stringEncoding = 'utf8'
  const taskRepresentation = {
    modelDescription: modelDescription.toString(stringEncoding),
    templates: {
      parameter: templateParameters.toString(stringEncoding),
      io: templateIO.toString(stringEncoding)
    },
    records: _.split(req.query.records, ',')
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

  // Store file persistently iff it doesn't exist already
  const modelDirectory = `${cfg.fs}/models/${modelId}`
  const modelFilePath = _.replace(tmpFile, tmpDir, modelDirectory)
  const modelFilePathExists = await fs.pathExists(modelFilePath)

  if (!modelFilePathExists) {
    await fs.ensureDir(modelDirectory)
    await fs.move(tmpFile, modelFilePath)
  }

  // Persist changes to internal list of models
  modelRepresentation.fmuFilePath = modelFilePath
  await updateInternalListOfModels(modelId, modelRepresentation, 'set')

  // Clean up temporary files/directories
  await fs.remove(tmpDir)

  // Add schemata for parameters/inputs to OAS
  const parameters = {
    allOf: [
      { $ref: '#/components/schemas/ModelInstance' },
      {
        type: 'object',
        properties: {
          parameters: modelRepresentation.schemata.parameter
        }
      }
    ]
  }
  const input = {
    allOf: [
      { $ref: '#/components/schemas/ExperimentSetup' },
      {
        type: 'object',
        required: ['inputTimeseries'],
        properties: {
          inputTimeseries: modelRepresentation.schemata.input
        }
      }
    ]
  }
  await updateOpenAPISpecification(modelRepresentation.modelName, parameters, 'set')
  await updateOpenAPISpecification(modelRepresentation.guid, input, 'set')

  // Restart backend
  c.api = initializeBackend(cfg.oas.filePathDynamic) // hope this works... it does!

  // Return 201 pointing to resource exposing the model
  res
    .status(201)
    .location(`${origin}/models/${modelId}`)
    .json()
}

async function getModel (c, req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')

  const modelRepresentation = listOfModels[modelId]
  const fmuFilePath = modelRepresentation.fmuFilePath

  delete modelRepresentation.schemata

  res.format({
    'application/json': function () {
      res.status(200).json(modelRepresentation)
    },

    'application/octet-stream': async function () {
      const fileContent = await fs.readFile(fmuFilePath)
      res.status(200).send(fileContent)
    },

    default: responseUtils.respondWithNotFound
  })
}

async function createModelInstance (c, req, res) {
  const requestBody = _.get(req, ['body'])

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  const modelInstanceId = uuid.v4()

  // Create internal representation of new model instance
  modelInstanceCache.set(modelInstanceId, {
    model: {
      href: requestBody.modelHref,
      id: requestBody.modelId
    },
    parameterSet: requestBody.parameters
  })
  knownModelInstances.push(modelInstanceId)

  // Immediately return `201 Created` with corresponding `Location`-header
  res.set('Content-Type', 'application/json')
  res
    .status(201)
    .location(`${origin}/models/${requestBody.modelId}/instances/${modelInstanceId}`)
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
    setup: requestBody,
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

// Export handlers
exports.initializeBackend = initializeBackend
exports.addModel = addModel
exports.getModel = getModel
exports.createModelInstance = createModelInstance
exports.getModelInstance = getModelInstance
exports.simulateModelInstance = simulateModelInstance
exports.getExperimentStatus = getExperimentStatus
exports.getExperimentResult = getExperimentResult
