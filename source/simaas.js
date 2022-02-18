// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

// Load modules
const _ = require('lodash')
const fs = require('fs-extra')
const path = require('path')
const uuid = require('uuid')
const celery = require('celery-ts')
const NodeCache = require('node-cache')
const { promiseStatus } = require('promise-status-async')
const { OpenAPIBackend } = require('openapi-backend')
const $RefParser = require('@apidevtools/json-schema-ref-parser')
const N3 = require('n3')
const { pipeline } = require('stream/promises')
const storeStream = require('rdf-store-stream').storeStream
const { defaultGraph } = N3.DataFactory
const axios = require('axios')

const log = require('./logger.js')
const responseUtils = require('./response_utils.js')
const {
  knownPrefixes,
  Model,
  ModelInstance,
  Simulation,
  SimulationResult
} = require('./resources.js')

// Use global objects as datastore
const cfg = {
  oas: {
    filePathStatic: './templates/simaas_oas3.json',
    path: {
      oas: _.replace('/oas', '/', ''),
      ui: _.replace(process.env.UI_URL_PATH, '/', '')
    }
  },
  tmpfs: process.env.SIMAAS_TMPFS_PATH,
  fs: process.env.SIMAAS_FS_PATH,
  qpf: {
    expose: process.env.QPF_SERVER_EXPOSE === 'true' ?? true,
    containerEngine: process.env.QPF_SERVER_CONTAINER_ENGINE,
    containerName: process.env.QPF_SERVER_CONTAINER
  },
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

cfg.oas.filePathDynamic = `${cfg.fs}/OAS.json` // careful, also defined in `index.js`
cfg.qpf.sourceFilePath = `${cfg.fs}/data.trig` // careful, also defined in `index.js`

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
const knownExperiments = []
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

async function updateDataSet (quadsToAdd) {
  const inputStream = fs.createReadStream(cfg.qpf.sourceFilePath)
  const streamParser = new N3.StreamParser({ format: 'application/trig' })

  inputStream.pipe(streamParser)
  const store = await storeStream(streamParser)
  store.addQuads(quadsToAdd)

  const outputStream = fs.createWriteStream(cfg.qpf.sourceFilePath)
  const streamWriter = new N3.StreamWriter({
    prefixes: knownPrefixes,
    format: 'application/trig'
  })

  await pipeline(store.match(null, null, null), streamWriter, outputStream)

  // Reload `@ldf/server` so changes are taken into account
  // https://github.com/LinkedDataFragments/Server.js/tree/master/packages/server#reload-running-server
  let socketPath
  if (cfg.qpf.containerEngine === 'docker') {
    socketPath = '/var/run/docker.sock'
  } else {
    log.error(`Container engine '${cfg.qpf.containerEngine} not yet supported!`)
  }

  await axios({
    method: 'POST',
    url: `/containers/${cfg.qpf.containerName}/kill?signal=SIGHUP`,
    socketPath: socketPath
  })
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

// Define handlers
function initializeBackend (oasFilePath) {
  let backend = null
  try {
    backend = new OpenAPIBackend({
      definition: oasFilePath,
      strict: true,
      validate: false,
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

async function getApiRoot (req, res) {
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
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  const listOfModels = await updateInternalListOfModels(null, null, 'read')

  res.format({
    'application/trig': function () {
      res.status(200).render('resources/models_collection.trig.jinja', {
        fmi_url: knownPrefixes.fmi,
        sms_url: knownPrefixes.sms,
        api_url: `${origin}/vocabulary#`,
        base_url: thisURL,
        base_separator: '/',
        modelURIs: _.map(_.keys(listOfModels), function (v) {
          return `${thisURL}/${v}`
        })
      })
    }
  })
}

async function addModel (c, req, res) {
  // Receive file content, store in temporary file
  const tmpDir = `${cfg.tmpfs}/${uuid.v4()}`
  const tmpFile = `${tmpDir}/model.fmu`
  await fs.ensureDir(tmpDir)
  await fs.writeFile(tmpFile, req.body)

  // Create internal representation by instantiating class `Model`
  const model = await Model.init(req, tmpFile, cfg.fs, celeryClient)

  // Update read-only data set exposed via QPFs with triples about new model
  if (cfg.qpf.expose === true) {
    for (const part of ['model', 'types', 'units', 'variables']) {
      const inputStream = fs.createReadStream(model[part]['application/trig'])
      const streamParser = new N3.StreamParser({ format: 'application/trig' })
      inputStream.pipe(streamParser)
      const store = await storeStream(streamParser)

      await updateDataSet(store.getQuads(null, null, null, defaultGraph()))
    }
  }

  // Persist changes to internal list of models
  await updateInternalListOfModels(model.id, model, 'set')

  // Clean up temporary files/directories
  // -- obviously doesn't work if the API crashes before reaching this...
  await fs.remove(tmpDir)

  // Add schemata for parameters/inputs/outputs to OAS
  await updateOpenAPISpecification(model.name, model.schemata.parameter, 'set')
  await updateOpenAPISpecification(model.id, model.schemata.input, 'set')

  // Restart backend
  c.api = initializeBackend(cfg.oas.filePathDynamic) // hope this works... it does!

  // Return 201 pointing to resource exposing the model
  res.format({
    'application/trig': function () {
      res
        .status(201)
        .location(model.iri)
        .render('responses/add_model.trig.jinja', {
          model: model.iri,
          sms_url: knownPrefixes.sms
        })
    },

    'application/json': function () {
      res
        .status(201)
        .location(model.iri)
        .json()
    }
  })
}

async function getModel (c, req, res) {
  const origin = `${req.protocol}://${req.headers.host}`
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const model = await Model.fromJSON(origin, listOfModels[modelId])

  res.format({
    'application/trig': async function () {
      const representation = await model.asRDF('application/trig')
      res.status(200).send(representation)
    },

    'application/ld+json': async function () {
      const representation = await model.asRDF('application/ld+json')
      res.status(200).json(representation)
    },

    'application/json': async function () {
      const representation = await model.asJSON()
      res.status(200).json(representation)
    },

    'application/octet-stream': async function () {
      const fmuFilePath = model.model['application/octet-stream']
      const fileContent = await fs.readFile(fmuFilePath)
      res.status(200).send(fileContent)
    },

    default: responseUtils.respondWithNotFound
  })
}

async function getModelTypes (req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const modelTypes = listOfModels[modelId].types

  res.format({
    'application/trig': async function () {
      const representation = await fs.readFile(modelTypes['application/trig'], {
        encoding: 'utf-8'
      })
      res.status(200).send(representation)
    },
    'application/ld+json': async function () {
      const representation = await fs.readJSON(modelTypes['application/ld+json'])
      res.status(200).json(representation)
    }
  })
}

async function getModelUnits (req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const modelUnits = listOfModels[modelId].units

  res.format({
    'application/trig': async function () {
      const representation = await fs.readFile(modelUnits['application/trig'], {
        encoding: 'utf-8'
      })
      res.status(200).send(representation)
    },
    'application/ld+json': async function () {
      const representation = await fs.readJSON(modelUnits['application/ld+json'])
      res.status(200).json(representation)
    }
  })
}

async function getModelVariables (req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const modelVariables = listOfModels[modelId].variables

  res.format({
    'application/trig': async function () {
      const representation = await fs.readFile(modelVariables['application/trig'], {
        encoding: 'utf-8'
      })
      res.status(200).send(representation)
    },
    'application/ld+json': async function () {
      const representation = await fs.readJSON(modelVariables['application/ld+json'])
      res.status(200).json(representation)
    }
  })
}

async function deleteModel (c, req, res) {
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')

  const fmuFilePath = listOfModels[modelId].model['application/octet-stream']
  const modelDirectory = path.dirname(fmuFilePath)
  const modelName = listOfModels[modelId].name

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

async function getModelInstanceCollection (req, res) {
  const origin = `${req.protocol}://${req.headers.host}`
  const thisURL = `${origin}${req.path}`

  const modelId = _.nth(_.split(req.path, '/'), 2)
  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const model = await Model.fromJSON(origin, listOfModels[modelId])

  // Get rid of `@prefix`-declarations assuming all necessary ones are in the template
  const prefixRegEx = /@prefix [\w\d\s.:<>/#-]*\.\n/gm
  let shapes = await fs.readFile(model.shapes['application/trig'], {
    encoding: 'utf-8'
  })
  shapes = shapes.replace(prefixRegEx, '')

  res.format({
    'application/trig': function () {
      // TODO the following depends on the model! to be revised
      res.status(200).render('resources/model_instances_collection.trig.jinja', {
        fmi_url: knownPrefixes.fmi,
        sms_url: knownPrefixes.sms,
        api_url: `${origin}/vocabulary#`,
        base_url: thisURL,
        base_separator: '/',
        instanceURIs: _.map(knownModelInstances, function (v) {
          return `${thisURL}/${v}`
        }),
        modelURI: model.iri,
        shapes_graph: shapes
      })
    }
  })
}

async function createModelInstance (c, req, res) {
  const origin = `${req.protocol}://${req.headers.host}`
  const requestBody = req.body
  const mimetype = _.get(req, ['headers', 'content-type'])

  const listOfModels = await updateInternalListOfModels(null, null, 'read')
  const modelId = _.nth(_.split(req.path, '/'), 2)
  const model = await Model.fromJSON(origin, listOfModels[modelId])

  // Parse request body
  const instance = await ModelInstance.init(model, requestBody, mimetype)

  if (cfg.qpf.expose === true) {
    await updateDataSet(instance.graph.getQuads(null, null, null, defaultGraph()))
  }

  // Save internal representation of new model instance to cache
  modelInstanceCache.set(instance.id, instance)
  knownModelInstances.push(instance.id)

  // Immediately return `201 Created` with corresponding `Location`-header
  res.format({
    'application/trig': function () {
      res
        .status(201)
        .location(instance.iri)
        .send(
          `@prefix sms: <${knownPrefixes.sms}> .
         <${instance.iri}> a sms:ModelInstance ;
             sms:instanceOf <${model.iri}> .`
        )
    },

    'application/json': function () {
      res
        .status(201)
        .location(instance.iri)
        .json()
    }
  })
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
    res.format({
      'application/trig': async function () {
        const representation = await modelInstance.asRDF('application/trig')
        res.status(200).send(representation)
      },
      'application/ld+json': async function () {
        const representation = await modelInstance.asRDF('application/ld+json')
        res.status(200).json(representation)
      },
      'application/json': async function () {
        const representation = await modelInstance.asJSON()
        res.status(200).json(representation)
      }
    })
    req.log.info(
      { res: res },
      `successfully handled ${req.method}-request on ${req.path}`
    )
  }
}

async function getExperimentCollection (req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  res.format({
    'application/trig': function () {
      // TODO the following depends on the model! to be revised
      res.status(200).render('resources/simulations_collection.trig.jinja', {
        fmi_url: knownPrefixes.fmi,
        sms_url: knownPrefixes.sms,
        api_url: `${origin}/vocabulary#`,
        base_url: thisURL,
        base_separator: '/',
        simulations: _.map(knownExperiments, function (v) {
          return `${thisURL}/${v}`
        }),
        instance_uri: _.join(_.slice(_.split(thisURL, '/'), 0, -1), '/')
      })
    }
  })
}

async function simulateModelInstance (c, req, res) {
  const requestBody = req.body
  const mimetype = _.get(req, ['headers', 'content-type'])

  // Parse request body to internal representation
  const modelInstanceId = _.nth(_.split(req.path, '/'), 4)
  const modelInstance = modelInstanceCache.get(modelInstanceId)
  const simulation = await Simulation.init(modelInstance, requestBody, mimetype)

  // Amend request body with additional required information to build task signature
  const taskRepresentation = await simulation.asTask()
  taskRepresentation.requestId = req.id

  // Enqueue request
  const task = celeryClient.createTask('worker.tasks.simulate')
  const job = task.applyAsync({
    args: [taskRepresentation],
    kwargs: {}
  })

  // Store experiment setup identified by UUID
  const experimentId = simulation.id
  jobQueue[experimentId] = job
  knownExperiments.push(experimentId)
  experimentCache.set(experimentId, {
    simulation: simulation,
    simulationResult: null
  })

  // Immediately return `201 Created` with corresponding `Location`-header
  res.format({
    'application/trig': function () {
      res
        .status(201)
        .location(simulation.iri)
        .send(
          `@prefix sms: <${knownPrefixes.sms}> .
         <${simulation.iri}> a sms:Simulation ;
             sms:simulates <${simulation.instance.iri}> .`
        )
    },

    'application/json': function () {
      res
        .status(201)
        .location(simulation.iri)
        .json()
    }
  })
}

async function getExperimentStatus (c, req, res) {
  const experimentId = _.last(_.split(req.url, '/'))
  const cachedExperiment = experimentCache.get(experimentId)

  if (cachedExperiment == null) {
    if (_.has(jobQueue, experimentId)) {
      await responseUtils.respondWithGone(c, req, res)
    } else {
      await responseUtils.respondWithNotFound(c, req, res)
    }
  } else {
    const simulation = cachedExperiment.simulation
    const job = jobQueue[experimentId]
    let jobStatus
    let simulationResult
    let simulationResultRaw
    const promise = job.result
    if ((await promiseStatus(promise)) === 'resolved') {
      jobStatus = 'SUCCESS'
      simulationResultRaw = await job.get()
      simulationResult = await SimulationResult.init(simulation, simulationResultRaw)
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

    simulation.status = status

    if (status === 'DONE') {
      simulation.resultExists = true
      experimentCache.set(experimentId, {
        simulation: simulation,
        simulationResult: simulationResult
      })
    }

    res.format({
      'application/trig': async function () {
        const representation = await simulation.asRDF('application/trig')
        res.status(200).send(representation)
      },
      'application/ld+json': async function () {
        const representation = await simulation.asRDF('application/ld+json')
        res.status(200).json(representation)
      },
      'application/json': async function () {
        const representation = await simulation.asJSON()
        res.status(200).json(representation)
      }
    })
    req.log.info(
      { res: res },
      `successfully handled ${req.method}-request on ${req.path}`
    )
  }
}

async function getExperimentResult (c, req, res) {
  const experimentId = _.nth(_.split(req.url, '/'), -2)
  const simulationResult = experimentCache.get(experimentId).simulationResult

  if (simulationResult == null) {
    if (_.has(jobQueue, experimentId)) {
      await responseUtils.respondWithGone(c, req, res)
    } else {
      await responseUtils.respondWithNotFound(c, req, res)
    }
  } else {
    res.format({
      'application/trig': async function () {
        const representation = await simulationResult.asRDF('application/trig')
        res.status(200).send(representation)
      },
      'application/ld+json': async function () {
        const representation = await simulationResult.asRDF('application/ld+json')
        res.status(200).json(representation)
      },
      'application/json': async function () {
        const representation = await simulationResult.asJSON()
        res.status(200).json(representation)
      }
    })
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

async function serveRESTdesc (req, res) {
  const origin = `${req.protocol}://${req.headers.host}`

  log.info(`served RESTdesc to client in 'text/n3'`)
  res.format({
    'text/n3': async function () {
      res.set('content-type', 'text/n3')
      res.status(200).render('restdesc/*.n3', {
        origin: origin
      })
    }
  })
}

// Export handlers
exports.updateInternalListOfModels = updateInternalListOfModels
exports.updateOpenAPISpecification = updateOpenAPISpecification
exports.initializeBackend = initializeBackend
exports.getApiRoot = getApiRoot
exports.getApiVocabulary = getApiVocabulary
exports.getModelCollection = getModelCollection
exports.addModel = addModel
exports.getModel = getModel
exports.getModelTypes = getModelTypes
exports.getModelUnits = getModelUnits
exports.getModelVariables = getModelVariables
exports.deleteModel = deleteModel
exports.getModelInstanceCollection = getModelInstanceCollection
exports.createModelInstance = createModelInstance
exports.getModelInstance = getModelInstance
exports.getExperimentCollection = getExperimentCollection
exports.simulateModelInstance = simulateModelInstance
exports.getExperimentStatus = getExperimentStatus
exports.getExperimentResult = getExperimentResult
exports.serveOAS = serveOAS
exports.serveRESTdesc = serveRESTdesc
