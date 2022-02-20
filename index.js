// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

// Instantiate logger
const log = require('./source/logger.js')
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
const fs = require('fs-extra')
const delay = require('delay')
const addRequestId = require('express-request-id')()
const nunjucks = require('nunjucks')
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware')
const { processenv } = require('processenv')

const handlers = require('./source/simaas.js')
const responseUtils = require('./source/response_utils.js')

log.info({ code: 300010 }, 'successfully loaded modules')

// Declare global object for storing config; populated in `loadConfig`
let cfg = {}

// Define functions
async function checkIfConfigIsValid () {
  const config = {
    listenPort: parseInt(process.env.SIMAAS_LISTEN_PORT),
    heartbeatPeriod: parseInt(process.env.SIMAAS_HEARTBEAT_PERIOD) || 3600 * 1000,
    ui: {
      staticFilesPath:
        String(process.env.UI_STATIC_FILES_PATH) || './source/redoc.html',
      urlPath: String(process.env.UI_URL_PATH) || '/ui'
    },
    oas: {
      filePathStatic: './oas/simaas_oas3.json'
    },
    qpf: {
      expose: processenv('QPF_SERVER_EXPOSE', false),
      path: processenv('QPF_SERVER_PATH', '/knowledge-graph'),
      target: processenv('QPF_SERVER_ORIGIN'),
      configTemplate: processenv(
        'QPF_SERVER_CONFIG',
        './templates/ldf-server_config.json'
      ),
      dataTemplate: './templates/ldf-server_data.trig'
    },
    fs: process.env.SIMAAS_FS_PATH
  }

  config.oas.filePathDynamic = `${config.fs}/OAS.json` // careful, also in `simaas.js`
  config.qpf.configFilePath = `${config.fs}/ldf-server_config.json`
  config.qpf.sourceFilePath = `${config.fs}/data.trig` // careful, also in `simaas.js`

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

  // TODO use ?? instead of || or processenv()-syntax
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
  app.options('*', handlers.serveRESTdesc)

  app.use(bodyParser.json({ type: ['application/json', 'application/*+json'] }))
  app.use(
    bodyParser.text({
      type: ['application/trig', 'text/turtle', 'text/n3'],
      limit: '2mb'
    })
  )
  app.use(bodyParser.raw({ type: ['application/octet-stream'], limit: '50mb' }))
  app.use(cors())
  app.use(addRequestId)
  nunjucks.configure('templates', { autoescape: true, express: app })

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
  }

  // Create child logger including req_id to be used in handlers
  app.use((req, res, next) => {
    req.log = log.child({ req_id: req.id })
    req.log.info({ req: req }, `received ${req.method}-request on ${req.originalUrl}`) // XXX incompatible with GDPR!!
    next()
  })

  // Expose Quad/Triple Pattern Fragmens interface by proxying requests to LDF-server
  if (cfg.qpf.expose === true) {
    // Ensure that config-file and data source exist
    const qpfConfigExists = await fs.pathExists(cfg.qpf.configFilePath)
    const qpfDataExists = await fs.pathExists(cfg.qpf.sourceFilePath)

    if (qpfConfigExists === false) {
      await fs.copy(cfg.qpf.configTemplate, cfg.qpf.configFilePath)
    }

    if (qpfDataExists === false) {
      await fs.copy(cfg.qpf.dataTemplate, cfg.qpf.sourceFilePath)
    }

    // Proxy requests at designated path to instance of @ldf/server
    app.use(
      [cfg.qpf.path, '/assets'],
      createProxyMiddleware({
        target: cfg.qpf.target,
        changeOrigin: true, // idk if this is really necessary..
        // https://github.com/chimurai/http-proxy-middleware#intercept-and-manipulate-responses
        selfHandleResponse: true,
        onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
          const response = responseBuffer.toString('utf-8')
          const oldURL = `${cfg.qpf.target}${cfg.qpf.path}`
          const newURL = `${req.protocol}://${req.headers.host}${req.path}`
          return response.replaceAll(oldURL, newURL)
        })
      })
    )
  }

  // Rebuild dynamic OAS to ensure that upgrades are propagated but models are kept
  await fs.remove(cfg.oas.filePathDynamic)
  await handlers.updateOpenAPISpecification(null, null, 'read') // ensure existence
  const objOfModels = await handlers.updateInternalListOfModels(null, null, 'read')
  const modelIds = _.keys(objOfModels)

  for (const modelId of modelIds) {
    const modelRepresentation = objOfModels[modelId]
    await handlers.updateOpenAPISpecification(
      modelRepresentation.modelName,
      modelRepresentation.schemata.parameter,
      'set'
    )
    await handlers.updateOpenAPISpecification(
      modelRepresentation.guid,
      modelRepresentation.schemata.input,
      'set'
    )
  }

  // Read API-specification and initialize backend
  const backend = handlers.initializeBackend(cfg.oas.filePathDynamic)

  // Pass requests to middleware
  app.get('/', handlers.getApiRoot)
  app.get('/vocabulary', handlers.getApiVocabulary)
  app.get('/models', handlers.getModelCollection)
  app.get('/models/:id/types', handlers.getModelTypes)
  app.get('/models/:id/units', handlers.getModelUnits)
  app.get('/models/:id/variables', handlers.getModelVariables)
  app.get('/models/:id/instances', handlers.getModelInstanceCollection)
  app.get('/models/:id/instances/:id/experiments', handlers.getExperimentCollection)
  app.use((req, res, next) => backend.handleRequest(req, req, res, next))

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
