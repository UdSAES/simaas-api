'use strict'

// Load modules
const _ = require('lodash')
const uuid = require('uuid')
const celery = require('celery-ts')
const NodeCache = require('node-cache')
const { promiseStatus } = require('promise-status-async')

const responseUtils = require('./response_utils.js')

// Use global objects as datastore
const cfg = {
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
    .location(origin + '/model-instance/' + modelInstanceId)
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
  const modelInstance = modelInstanceCache.get(requestBody.modelInstanceId)
  const taskRepresentation = {
    modelInstanceId: requestBody.modelInstanceId, // TODO derive; not from user
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
    .location(origin + '/experiments/' + experimentId)
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
      setup.linkToResult = origin + '/experiments/' + experimentId + '/result'
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
exports.createModelInstance = createModelInstance
exports.getModelInstance = getModelInstance
exports.simulateModelInstance = simulateModelInstance
exports.getExperimentStatus = getExperimentStatus
exports.getExperimentResult = getExperimentResult
