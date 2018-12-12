'use strict'

// Create logger
const { createLogger } = require('designetz_logger')
const log = createLogger({
  name: 'simaas_api',
  target: console.log,
  levelFilter: 0
})
log.any('service instance started', 300000)

// Exit immediately on uncaught errors or unhandled promise rejections
process.on('unhandledRejection', function (error) {
  log.any('unhandled promise rejection', 600050, error)
  process.exit(1)
})

process.on('uncaughtException', function (error) {
  log.any('uncaught exception', 600050, error)
  process.exit(1)
})

// Handle shutdown signals gracefully
process.on('SIGINT', shutDownGracefully)
process.on('SIGTERM', shutDownGracefully)

// Load modules
const express = require('express')
const { URL } = require('url')
var bodyParser = require('body-parser')
require('express-async-errors')
const cors = require('cors')
const _ = require('lodash')
const request = require('request-promise-native')
const swaggerTools = require('swagger-tools')
const $RefParser = require('json-schema-ref-parser')
const fs = require('fs-extra')
const delay = require('delay')
const serializeError = require('serialize-error')

log.any('successfully loaded modules', 300010)

// Load configuration
const QUEUE_ORIGIN = process.env.QUEUE_ORIGIN
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT)
const UI_STATIC_FILES_PATH = String(process.env.UI_STATIC_FILES_PATH) || ''
const UI_URL_PATH = String(process.env.UI_URL_PATH) || ''
const ALIVE_EVENT_WAIT_TIME = parseInt(process.env.ALIVE_EVENT_WAIT_TIME) || 3600 * 1000
const API_SPECIFICATION_FILE_PATH = './oas/simaas_oas2.json'

// Check if configuration is valid
async function checkIfConfigIsValid () {
  if (!_.isString(QUEUE_ORIGIN)) {
    log.any('QUEUE_ORIGIN is ' + QUEUE_ORIGIN + ' but must be a valid protocol+host-combination (e.g. http://127.0.0.1:12345)', 600020)
    process.exit(1)
  }

  if (!(_.isNumber(LISTEN_PORT) && LISTEN_PORT > 0 && LISTEN_PORT < 65535)) {
    log.any('LISTEN_PORT is ' + LISTEN_PORT + ' but must be an integer number larger than 0 and smaller than 65535', 600020)
    process.exit(1)
  }

  if (!(_.isNumber(ALIVE_EVENT_WAIT_TIME) && ALIVE_EVENT_WAIT_TIME > 0)) {
    log.any('ALIVE_EVENT_WAIT_TIME is ' + ALIVE_EVENT_WAIT_TIME + ' but must be positive integer number larger than 0', 600020)
    process.exit(1)
  }

  // TODO check validity of UI_STATIC_FILES_PATH
  // TODO check validity of UI_URL_PATH
  // TODO check validity of ALIVE_EVENT_WAIT_TIME
  // TODO check validity of API_SPECIFICATION_FILE_PATH

  log.any('configuration is valid, moving on', 300020)
}

// Instantiate express-application and set up middleware-stack
let server // global server object, populated when binding to port in init()
const app = express()
app.use(bodyParser.json())
app.use(cors())

// Expose OpenAPI-specification as /oas
app.use('/oas', express.static(API_SPECIFICATION_FILE_PATH))

// Expose UI iff UI_URL_PATH is not empty
if (UI_URL_PATH !== '') {
  if (UI_STATIC_FILES_PATH !== '') {
    // Expose locally defined UI
    app.use(UI_URL_PATH, express.static(UI_STATIC_FILES_PATH))
    log.any('exposing UI as ' + UI_URL_PATH, 300020)
  } else {
    // Fall back to default-UI
    log.any('default-UI not implemented', 600020)
    process.exit(1)
  }

  // Redirect GET-request on origin to UI iff UI is exposed
  app.get('', async (req, res) => {
    res.redirect(UI_URL_PATH)
  })
}

// Define functions
async function aliveLoop () {
  while (true) {
    await delay(ALIVE_EVENT_WAIT_TIME)
    log.any('service instance still running', 300100)
  }
}

function shutDownGracefully () {
  log.any('received request to shut down', 300050)

  // Stop receiving new requests, close server when all connections are ended
  server.close(() => {
    log.info('closed HTTP server')

    // TODO Clean up resources

    // Shut down the process
    log.any('shut down gracefully', 300060)
    process.exit(0)
  })
}

// Define handlers
async function respondWithNotImplemented (req, res) {
  res.status(501).json({
    'title': 'Not Implemented',
    'status': 501,
    'detail': 'The request was understood, but the underlying implementation is not available yet.'
  })
}

async function simulateModelInstance (req, res) {
  const modelInstanceID = _.get(req, ['body', 'modelInstanceID'])
  const simulationParameters = _.get(req, ['body', 'simulationParameters'])
  const inputTimeseries = _.get(req, ['body', 'inputTimeseries'])

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  let postTaskResult = null
  try {
    postTaskResult = await request({
      url: QUEUE_ORIGIN + '/tasks',
      method: 'post',
      json: true,
      resolveWithFullResponse: true,
      body: {
        model_instance_id: modelInstanceID,
        simulation_parameters: simulationParameters,
        input_timeseries: inputTimeseries
      }
    })
  } catch (error) {
    res.status(error.statusCode).json({ 'error': error.error.err })
    return
  }

  if (postTaskResult.statusCode !== 202) {
    res.status(500).json({ 'error': 'got status code ' + postTaskResult.statusCode + ' instead of 202' })
    return
  }

  const sourceLocationHeader = _.get(postTaskResult, ['headers', 'location'])
  const u = new URL(sourceLocationHeader, 'http://127.0.0.1')

  res.status(202).location(origin + u.pathname.replace('/tasks/', '/experiments/')).json()
}

async function getExperimentStatus (req, res) {
  const experimentID = _.get(req, ['params', 'experimentID'])

  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  let postTaskResult = null
  try {
    postTaskResult = await request({
      url: QUEUE_ORIGIN + '/tasks/' + experimentID + '/status',
      method: 'get',
      json: true,
      resolveWithFullResponse: true
    })
  } catch (error) {
    res.status(error.statusCode).json({ 'error': error.error.err })
    return
  }

  const sourceLinkToResult = _.get(postTaskResult, ['body', 'linkToResult'])
  let targetLinkToResult = null
  const resultBody = postTaskResult.body

  // Delete properties that shall not be exposed to the consumer
  delete resultBody.id
  delete resultBody.timestamp_created
  delete resultBody.timestamp_process_started

  if (_.isString(sourceLinkToResult)) {
    const u = new URL(sourceLinkToResult, 'http://127.0.0.1')
    targetLinkToResult = origin + u.pathname.replace('/tasks/', '/experiments/')
    resultBody.linkToResult = targetLinkToResult
  }

  res.status(200).json(resultBody)
}

async function getExperimentResult (req, res) {
  const experimentID = _.get(req, ['params', 'experimentID'])

  let postTaskResult = null
  try {
    postTaskResult = await request({
      url: QUEUE_ORIGIN + '/tasks/' + experimentID + '/result',
      method: 'get',
      json: true,
      resolveWithFullResponse: true
    })
  } catch (error) {
    res.status(error.statusCode).json({ 'error': error.error.err })
    return
  }

  const resultBody = postTaskResult.body

  // Transform body to specified format
  resultBody.description = 'The results of simulating model instance [ID] from [startTime] to [stopTime].'

  // Delete properties that shall not be exposed to the consumer
  delete resultBody.id
  delete resultBody.err

  res.status(200).json(resultBody)
}

// Define main program
async function init () {
  await checkIfConfigIsValid()

  let api = null
  try {
    api = await fs.readJson(API_SPECIFICATION_FILE_PATH, {
      encoding: 'utf8'
    })
    api = await $RefParser.dereference(api)
    log.any('successfully loaded API description ' + API_SPECIFICATION_FILE_PATH, 300020)
  } catch (error) {
    log.any('error while loading API description ' + API_SPECIFICATION_FILE_PATH, 600010, error)
    process.exit(1)
  }

  swaggerTools.initializeMiddleware(api, function (middleware) {
    // Interpret Swagger resources and attach metadata to request
    // -- must be first in swagger-tools middleware chain
    app.use(middleware.swaggerMetadata())

    // Validate Swagger requests
    // https://github.com/apigee-127/swagger-tools/blob/master/docs/Middleware.md#swagger-validator
    app.use(middleware.swaggerValidator({
      validateResponse: true
    }))

    log.any('configuration successfull', 300030)

    // Define routing
    // MUST happen after enabling swaggerValidator or validation doesn't work
    app.use((req, res, next) => {
      log.info(
        'received ' + req.method + '-request on ' + req.path +
        ', accepted media types are: ' + req.headers.accept
      )
      next()
    })
    app.get('/model-instances', respondWithNotImplemented)
    app.post('/model-instances', respondWithNotImplemented)
    app.get('/model-instances/:modelInstanceID', respondWithNotImplemented)
    app.delete('/model-instances/:modelInstanceID', respondWithNotImplemented)
    app.get('/experiments', respondWithNotImplemented)
    app.post('/experiments', simulateModelInstance)
    app.get('/experiments/:experimentID', respondWithNotImplemented)
    app.get('/experiments/:experimentID/status', getExperimentStatus)
    app.get('/experiments/:experimentID/result', getExperimentResult)

    app.use(function (req, res, next) {
      res.status(404).json({
        'title': 'Not Found',
        'status': 404,
        'detail': 'The requested resource was not found on this server'
      })
    }) // http://expressjs.com/en/starter/faq.html

    // Ensure that any remaining errors are serialized as JSON
    app.use(function (err, req, res, next) {
      if (res.headersSent) {
        return next(err)
      }
      switch (err.code) {
        case 'SCHEMA_VALIDATION_FAILED':
          log.any('schema validation failed -- request dropped', 401099, err)
          res.status(400).json({ error: serializeError(err) })
          break
        case 'PATTERN':
          log.any('schema validation failed -- request dropped', 401099, err)
          res.status(400).json({ error: serializeError(err) })
          break
        default:
          log.any('an internal server error occured and was caught at the end of the chain', 501000, err)
          res.status(500).json({ error: serializeError(err) })
      }
    })

    server = app.listen(LISTEN_PORT, function () {
      log.any('now listening on port ' + LISTEN_PORT, 300040)
    })

    // XXX is this even functional?
    app.on('error', function (error) {
      log.any('cannot bind to listening port ' + LISTEN_PORT, 600030, error)
      process.exit(1)
    })
  })
}

// Enter main tasks
init()
aliveLoop()
