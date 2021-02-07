'use strict'

// Instantiate logger
const log = require('./lib/logger.js')
log.info({ code: 300000 }, 'service instance started')

// Exit immediately on uncaught errors or unhandled promise rejections
process.on('unhandledRejection', function (error) {
  log.fatal({ err: error, code: 600050 }, 'unhandled promise rejection')
  process.exit(1)
})

process.on('uncaughtException', function (error) {
  log.fatal({ err: error, code: 600050 }, 'uncaught exception')
  process.exit(1)
})

// Handle shutdown signals gracefully
let server // global server object, populated when binding to port in init()
process.on('SIGINT', shutDownGracefully)
process.on('SIGTERM', shutDownGracefully)

// Load modules
const express = require('express')
var bodyParser = require('body-parser')
require('express-async-errors')
const cors = require('cors')
const _ = require('lodash')
const delay = require('delay')
const addRequestId = require('express-request-id')()
const { OpenAPIBackend } = require('openapi-backend')

const handlers = require('./lib/simaas.js')
const responseUtils = require('./lib/response_utils.js')

log.info({ code: 300010 }, 'successfully loaded modules')

// Load configuration
const QUEUE_ORIGIN = process.env.QUEUE_ORIGIN
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT)
const UI_STATIC_FILES_PATH = String(process.env.UI_STATIC_FILES_PATH) || ''
const UI_URL_PATH = String(process.env.UI_URL_PATH) || ''
const ALIVE_EVENT_WAIT_TIME = parseInt(process.env.ALIVE_EVENT_WAIT_TIME) || 3600 * 1000
const API_SPECIFICATION_FILE_PATH = './oas/simaas_oas3_flat.yaml'

// Define functions
async function checkIfConfigIsValid () {
  if (!_.isString(QUEUE_ORIGIN)) {
    log.fatal({ code: 600020 }, 'QUEUE_ORIGIN is ' + QUEUE_ORIGIN + ' but must be a valid protocol+host-combination (e.g. http://127.0.0.1:12345)')
    process.exit(1)
  }

  if (!(_.isNumber(LISTEN_PORT) && LISTEN_PORT > 0 && LISTEN_PORT < 65535)) {
    log.fatal({ code: 600020 }, 'LISTEN_PORT is ' + LISTEN_PORT + ' but must be an integer number larger than 0 and smaller than 65535')
    process.exit(1)
  }

  if (!(_.isNumber(ALIVE_EVENT_WAIT_TIME) && ALIVE_EVENT_WAIT_TIME > 0)) {
    log.fatal({ code: 600020 }, 'ALIVE_EVENT_WAIT_TIME is ' + ALIVE_EVENT_WAIT_TIME + ' but must be positive integer number larger than 0')
    process.exit(1)
  }

  // TODO check validity of UI_STATIC_FILES_PATH
  // TODO check validity of UI_URL_PATH
  // TODO check validity of LOG_LEVEL?
  // TODO check validity of ALIVE_EVENT_WAIT_TIME
  // TODO check validity of API_SPECIFICATION_FILE_PATH

  log.info({ code: 300020 }, 'configuration is valid, moving on')
}

async function aliveLoop () {
  while (true) {
    await delay(ALIVE_EVENT_WAIT_TIME)
    log.info({ code: 300100 }, 'service instance still running')
  }
}

function shutDownGracefully () {
  log.info({ code: 300050 }, 'received request to shut down')

  // Stop receiving new requests, close server when all connections are ended
  server.close(() => {
    log.info('closed HTTP server')

    // TODO Clean up resources

    // Shut down the process
    log.info({ code: 300060 }, 'shut down gracefully')
    process.exit(0)
  })
}

// Define main program
async function init () {
  await checkIfConfigIsValid()

  // Instantiate express-application and set up middleware-stack
  const app = express()
  app.use(bodyParser.json())
  app.use(cors())
  app.use(addRequestId)

  // Read API-specification and initialize backend
  let backend = null
  try {
    backend = new OpenAPIBackend({
      definition: API_SPECIFICATION_FILE_PATH,
      strict: true,
      validate: true,
      ajvOpts: {
        format: false
      }
    })
    log.info('successfully loaded API description ' + API_SPECIFICATION_FILE_PATH)
  } catch (error) {
    log.fatal('error while loading API description ' + API_SPECIFICATION_FILE_PATH)
    process.exit(1)
  }

  backend.init()

  // Expose UI iff UI_URL_PATH is not empty
  if (UI_URL_PATH !== '') {
    if (UI_STATIC_FILES_PATH !== '') {
      // Expose locally defined UI
      app.use(UI_URL_PATH, express.static(UI_STATIC_FILES_PATH))
      log.info({ code: 300020 }, 'exposing UI as ' + UI_URL_PATH)
    } else {
      // Fall back to default-UI
      log.fatal({ code: 600020 }, 'default-UI not implemented')
      process.exit(1)
    }

    // Redirect GET-request on origin to UI iff UI is exposed
    app.get('', async (req, res) => {
      res.redirect(UI_URL_PATH)
    })
  }

  // Create child logger including req_id to be used in handlers
  app.use((req, res, next) => {
    req.log = log.child({ req_id: req.id })
    req.log.info({ req: req }, `received ${req.method}-request on ${req.originalUrl}`) // XXX incompatible with GDPR!!
    next()
  })

  // Pass requests to middleware
  app.use((req, res, next) => backend.handleRequest(req, req, res, next))

  // Define routing
  backend.register('getListOfModelInstances', responseUtils.respondWithNotImplemented)
  backend.register('createModelInstance', handlers.createModelInstance)
  backend.register('getModelInstance', responseUtils.respondWithNotImplemented)
  backend.register('deleteModelInstance', responseUtils.respondWithNotImplemented)
  backend.register('getListOfExperiments', responseUtils.respondWithNotImplemented)
  backend.register('triggerSimulation', handlers.simulateModelInstance)
  backend.register('getExperiment', handlers.getExperimentStatus)
  backend.register('getExperimentResult', handlers.getExperimentResult)
  backend.register('getOAS', responseUtils.serveOAS)

  // Handle unsuccessful requests
  backend.register('validationFail', responseUtils.failValidation)
  backend.register('notImplemented', responseUtils.respondWithNotImplemented)
  backend.register('notFound', responseUtils.respondWithNotFound)

  // Serialize any remaining errors as JSON
  app.use(function (err, req, res, next) {
    log.error(
      'an internal server error occured and was caught at the end of the chain',
      err
    )
    if (res.headersSent) {
      return next(err)
    }

    responseUtils.sendProblemDetail(res, {
      title: 'Internal Server Error',
      status: 500
    })
  })

  log.info({ code: 300030 }, 'configuration successfull')

  // Start listening to incoming requests
  server = app.listen(LISTEN_PORT, function () {
    log.info({ code: 300040 }, 'now listening on port ' + LISTEN_PORT)
  })

  // XXX is this even functional?
  app.on('error', function (error) {
    log.fatal({ code: 600030, err: error }, 'cannot bind to listening port ' + LISTEN_PORT)
    process.exit(1)
  })
}

// Enter main tasks
if (require.main === module) {
  init()
  aliveLoop()
}
