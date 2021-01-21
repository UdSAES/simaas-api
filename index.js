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
// const { URL } = require('url')
var bodyParser = require('body-parser')
require('express-async-errors')
const cors = require('cors')
const _ = require('lodash')
// const request = require('request-promise-native')
const swaggerTools = require('swagger-tools')
const fs = require('fs-extra')
const delay = require('delay')
const serializeError = require('serialize-error')
const addRequestId = require('express-request-id')()

const handlers = require('./lib/simaas.js')
const responseUtils = require('./lib/response_utils.js')

log.info({ code: 300010 }, 'successfully loaded modules')

// Load configuration
const QUEUE_ORIGIN = process.env.QUEUE_ORIGIN
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT)
const UI_STATIC_FILES_PATH = String(process.env.UI_STATIC_FILES_PATH) || ''
const UI_URL_PATH = String(process.env.UI_URL_PATH) || ''
const ALIVE_EVENT_WAIT_TIME = parseInt(process.env.ALIVE_EVENT_WAIT_TIME) || 3600 * 1000
const API_SPECIFICATION_FILE_PATH_FLAT = './oas/simaas_oas2_flat.json'

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

  // Read API-specification and initialize backend
  let api = null
  try {
    api = await fs.readJson(API_SPECIFICATION_FILE_PATH_FLAT, { encoding: 'utf8' })
    log.info({ code: 300020 }, 'successfully loaded API description ' + API_SPECIFICATION_FILE_PATH_FLAT)
  } catch (error) {
    log.fatal({ code: 600010, err: error }, 'error while loading API description ' + API_SPECIFICATION_FILE_PATH_FLAT)
    process.exit(1)
  }

  app.use((req, res, next) => {
    req.log = log.child({ req_id: req.id })
    req.log.info({ req: req }, `received ${req.method}-request on ${req.originalUrl}`) // XXX incompatible with GDPR!!
    next()
  })

  swaggerTools.initializeMiddleware(api, function (middleware) {
    // Interpret Swagger resources and attach metadata to request
    // -- must be first in swagger-tools middleware chain
    app.use(middleware.swaggerMetadata())

    // Validate Swagger requests
    // https://github.com/apigee-127/swagger-tools/blob/master/docs/Middleware.md#swagger-validator
    app.use(middleware.swaggerValidator({
      validateResponse: true
    }))

    // Expose OpenAPI-specification as /oas
    app.get('/oas', responseUtils.serveOAS)

    // Define routing -- MUST happen after enabling swaggerValidator or validation doesn't work
    app.get('/model-instances', responseUtils.respondWithNotImplemented)
    app.post('/model-instances', responseUtils.respondWithNotImplemented)
    app.get('/model-instances/:modelInstanceID', responseUtils.respondWithNotImplemented)
    app.delete('/model-instances/:modelInstanceID', responseUtils.respondWithNotImplemented)
    app.get('/experiments', responseUtils.respondWithNotImplemented)
    app.post('/experiments', handlers.simulateModelInstance)
    app.get('/experiments/:experimentID', handlers.getExperimentStatus)
    app.get('/experiments/:experimentID/result', handlers.getExperimentResult)

    // Handle unsuccessfull requests
    app.use(function (req, res, next) {
      res.set('Content-Type', 'application/problem+json')
      res.status(404).json({
        'title': 'Not Found',
        'status': 404,
        'detail': 'The requested resource was not found on this server'
      })
      req.log.info({ res: res }, 'sent `404 Not Found` as response to ' + req.method + '-request on ' + req.path)
    }) // http://expressjs.com/en/starter/faq.html

    // Ensure that any remaining errors are serialized as JSON
    app.use(function (err, req, res, next) {
      if (res.headersSent) {
        req.log.fatal({ code: 600050, err: err }, 'headers already sent')
        process.exit(1)
      }

      switch (err.code) {
        case 'SCHEMA_VALIDATION_FAILED':
          req.log.warn({ code: 401099, err: err }, 'schema validation failed -- request dropped')
          res.set('Content-Type', 'application/problem+json')
          res.status(400).json({
            title: 'Schema Validation Failed',
            status: 400,
            detail: serializeError(err).message,
            path: serializeError(err).path
          })
          break
        case 'PATTERN':
          req.log.warn({ code: 401099, err: err }, 'schema validation failed -- request dropped')
          res.set('Content-Type', 'application/problem+json')
          res.status(400).json({
            title: 'Schema Validation Failed',
            status: 400,
            detail: serializeError(err).message,
            path: serializeError(err).path
          })
          break
        default:
          next(err)

          // XXX currently, you're busted if response validation fails!!  -- so:
          // TODO explicitly handle response validation failure -- this doesn't work

          // if (_.startsWith(err.message, 'Response validation failed')) {
          //   req.log.error({ code: 501099, err: err }, 'a response did not validate agains its schema')
          //   res.status(500).json({ error: serializeError(err) }) // XXX RFC7807
          //   break
          // } else {
          //   next(err)
          // }
      }
    })

    app.use(function (err, req, res, next) {
      req.log.error({ code: 501000, err: err }, 'an internal server error occured and was caught at the end of the chain')
      if (res.headersSent) {
        req.log.fatal({ code: 600050, err: err }, 'headers already sent')
        process.exit(1)
      }

      res.set('Content-Type', 'application/problem+json')
      res.status(500).json({
        title: 'Internal Server Error',
        status: 500,
        detail: 'An internal server error occured, please try again later'
      })
      req.log.error({ err: err }, 'sent `500 Internal Server Error` as response to ' + req.method + '-request on ' + req.path)
    })

    log.info({ code: 300030 }, 'configuration successfull')

    server = app.listen(LISTEN_PORT, function () {
      log.info({ code: 300040 }, 'now listening on port ' + LISTEN_PORT)
    })

    // XXX is this even functional?
    app.on('error', function (error) {
      log.fatal({ code: 600030, err: error }, 'cannot bind to listening port ' + LISTEN_PORT)
      process.exit(1)
    })
  })
}

// Enter main tasks
if (require.main === module) {
  init()
  aliveLoop()
}
