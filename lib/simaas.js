'use strict'

// Load modules
const _ = require('lodash')
const uuid = require('uuid')
const celery = require('celery-ts')
const { promiseStatus } = require('promise-status-async')

// Use global objects as datastore
let experiments = {}
let modelInstances = {
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
} // instance-id -> href model, parameter set, ...

// Instantiate connections to messaging broker and result storage
// TODO read hostnames from ENV
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
  modelInstances[modelInstanceId] = {
    model: {
      href: requestBody.model,
      inputTimeIsRelative: 'true' // TODO don't hardcode; derive from model
    },
    parameterSet: requestBody.parameters
  }

  // Immediately return `201 Created` with corresponding `Location`-header
  res.set('Content-Type', 'application/json')
  res
    .status(201)
    .location(origin + '/model-instance/' + modelInstanceId)
    .json()
}

async function simulateModelInstance (c, req, res) {
  const requestBody = _.get(req, ['body'])

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  // Amend request body with additional required information to build task signature
  const modelInstance = modelInstances[requestBody.modelInstanceID]
  const taskRepresentation = {
    modelInstanceId: requestBody.modelInstanceID, // TODO derive; not from user
    simulationParameters: {
      ...requestBody.simulationParameters,
      inputTimeIsRelative: modelInstance.model.inputTimeIsRelative
    },
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
  experiments[experimentId] = {
    job: job,
    setup: requestBody,
    simulationResult: null
  }

  // Immediately return `201 Created` with corresponding `Location`-header
  res.set('Content-Type', 'application/json')
  res
    .status(201)
    .location(origin + '/experiments/' + experimentId)
    .json()
}

async function getExperimentStatus (c, req, res) {
  const experimentID = _.last(_.split(req.url, '/'))

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  const resultBody = { ...experiments[experimentID].setup }

  let jobStatus
  let simulationResult
  const promise = experiments[experimentID].job.result
  if ((await promiseStatus(promise)) === 'resolved') {
    jobStatus = 'SUCCESS'
    simulationResult = await experiments[experimentID].job.get()
  } else if ((await promiseStatus(promise)) === 'rejected') {
    jobStatus = 'FAILURE'
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

  resultBody.status = status

  if (status === 'DONE') {
    resultBody.linkToResult = origin + '/experiments/' + experimentID + '/result'
    experiments[experimentID].simulationResult = {
      data: simulationResult
    }
  }

  res.status(200).json(resultBody)
  req.log.info(
    { res: res },
    `successfully handled ${req.method}-request on ${req.path}`
  )
}

async function getExperimentResult (c, req, res) {
  const experimentID = _.nth(_.split(req.url, '/'), -2)

  const modelInstanceID = _.get(experiments, [experimentID, 'setup', 'modelInstanceID'])
  const startTime = _.get(experiments, [
    experimentID,
    'setup',
    'simulationParameters',
    'startTime'
  ])
  const stopTime = _.get(experiments, [
    experimentID,
    'setup',
    'simulationParameters',
    'stopTime'
  ])

  const resultBody = experiments[experimentID].simulationResult

  // Transform body to specified format
  resultBody.description = `The results of simulating model instance ${modelInstanceID} from ${startTime} to ${stopTime}`

  res.status(200).json(resultBody)
  req.log.info(
    { res: res },
    `successfully handled ${req.method}-request on ${req.path}`
  )
}

// Export handlers
exports.createModelInstance = createModelInstance
exports.simulateModelInstance = simulateModelInstance
exports.getExperimentStatus = getExperimentStatus
exports.getExperimentResult = getExperimentResult
