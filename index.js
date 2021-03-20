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
  process.exit(2)
})

// Handle shutdown signals gracefully
let server // global server object, populated when binding to port in init()
process.on('SIGINT', shutDownGracefully)
process.on('SIGTERM', shutDownGracefully)

// Load modules
const express = require('express')
const bodyParser = require('body-parser')
require('express-async-errors')
const cors = require('cors')
const _ = require('lodash')
const delay = require('delay')
const addRequestId = require('express-request-id')()
const { OpenAPIBackend } = require('openapi-backend')

const handlers = require('./lib/simaas.js')
const responseUtils = require('./lib/response_utils.js')

log.info({ code: 300010 }, 'successfully loaded modules')

// Declare global object for storing config; populated in `loadConfig`
let cfg = {}

// Define functions
async function checkIfConfigIsValid () {
  const config = {
    listenPort: parseInt(process.env.SIMAAS_LISTEN_PORT),
    heartbeatPeriod: parseInt(process.env.SIMAAS_HEARTBEAT_PERIOD) || 3600 * 1000,
    ui: {
      staticFilesPath: String(process.env.UI_STATIC_FILES_PATH) || '',
      urlPath: String(process.env.UI_URL_PATH) || ''
    },
    oasFilePath: './oas/simaas_oas3.json',
    oasFilePathFlat: './oas/simaas_oas3_flat.yaml'
  }

  if (
    !(
      _.isNumber(config.listenPort) &&
      config.listenPort > 0 &&
      config.listenPort < 65535
    )
  ) {
    log.fatal(
      { code: 600020 },
      'SIMAAS_LISTEN_PORT is ' +
        config.listenPort +
        ' but must be an integer number larger than 0 and smaller than 65535'
    )
    process.exit(3)
  }

  if (!(_.isNumber(config.heartbeatPeriod) && config.heartbeatPeriod > 0)) {
    log.fatal(
      { code: 600020 },
      'SIMAAS_HEARTBEAT_PERIOD is ' +
        config.heartbeatPeriod +
        ' but must be positive integer number larger than 0'
    )
    process.exit(4)
  }

  // TODO check validity of UI_STATIC_FILES_PATH
  // TODO check validity of UI_URL_PATH
  // TODO check validity of LOG_LEVEL?
  // TODO check validity of ALIVE_EVENT_WAIT_TIME
  // TODO check validity of API_SPECIFICATION_FILE_PATH

  log.info({ code: 300020 }, 'configuration is valid, moving on')

  return config
}

async function aliveLoop () {
  while (true) {
    await delay(cfg.heartbeatPeriod)
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
  cfg = await checkIfConfigIsValid()

  // Instantiate express-application and set up middleware-stack
  const app = express()
  app.use(bodyParser.json())
  app.use(cors())
  app.use(addRequestId)

  // Read API-specification and initialize backend
  let backend = null
  try {
    backend = new OpenAPIBackend({
      definition: cfg.oasFilePath,
      strict: true,
      validate: true,
      ajvOpts: {
        format: false
      }
    })
    log.info('successfully loaded API description ' + cfg.oasFilePath)
  } catch (error) {
    log.fatal('error while loading API description ' + cfg.oasFilePath)
    process.exit(5)
  }

  backend.init()

  // Expose UI iff UI_URL_PATH is not empty
  if (cfg.ui.urlPath !== '') {
    if (cfg.ui.staticFilesPath !== '') {
      // Expose locally defined UI
      app.use(cfg.ui.urlPath, express.static(cfg.ui.staticFilesPath))
      log.info({ code: 300020 }, 'exposing UI as ' + cfg.ui.urlPath)
    } else {
      // Fall back to default-UI
      log.fatal({ code: 600020 }, 'default-UI not implemented')
      process.exit(6)
    }

    // Redirect GET-request on origin to UI iff UI is exposed
    app.get('', async (req, res) => {
      res.redirect(cfg.ui.urlPath)
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
  backend.register('createModelInstance', handlers.createModelInstance)
  backend.register('getModelInstance', responseUtils.respondWithNotImplemented)
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
  server = app.listen(cfg.listenPort, function () {
    log.info({ code: 300040 }, 'now listening on port ' + cfg.listenPort)
  })

  // XXX is this even functional?
  app.on('error', function (error) {
    log.fatal(
      { code: 600030, err: error },
      'cannot bind to listening port ' + cfg.listenPort
    )
    process.exit(7)
  })
}

// Enter main tasks
if (require.main === module) {
  init()
  aliveLoop()
}
