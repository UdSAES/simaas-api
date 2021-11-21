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
const { Readable } = require('stream')
const storeStream = require('rdf-store-stream').storeStream
const JsonLdParser = require('jsonld-streaming-parser').JsonLdParser
const JsonLdSerializer = require('jsonld-streaming-serializer').JsonLdSerializer

const log = require('./logger.js')
const responseUtils = require('./response_utils.js')
const { knownPrefixes, Model } = require('./resources.js')

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

// https://2ality.com/2019/11/nodejs-streams-async-iteration.html
// #collecting-the-contents-of-a-readable-stream-in-a-string
async function readableToString (readable) {
  let result = ''
  for await (const chunk of readable) {
    result += chunk
  }
  return result
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
async function instanceRepresentationFromRDF (content, mimetype) {
  let inputStream = null
  let streamParser = null
  const streamWriter = new JsonLdSerializer({ space: '  ', context: knownPrefixes })

  if (mimetype === 'application/ld+json') {
    inputStream = Readable.from(JSON.stringify(content))
    streamParser = new JsonLdParser()
  } else {
    inputStream = Readable.from(content.toString())
    streamParser = new N3.StreamParser({ format: mimetype })
  }

  inputStream.pipe(streamParser)
  const store = await storeStream(streamParser)

  store.match(null, null, null).pipe(streamWriter)
  let instanceRepresentationJSONLD = await readableToString(streamWriter)

  // Ensure that a properly formatted JSON object is returned
  instanceRepresentationJSONLD = JSON.parse(instanceRepresentationJSONLD)

  return instanceRepresentationJSONLD
}

async function simulationRepresentationFromRDF (content, mimetype) {
  const simulationRepresentation = await fs.readJSON(
    'test/data/6157f34f-f629-484b-b873-f31be22269e1/simulation.json'
  )

  return simulationRepresentation
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
  const tmpFile = `${tmpDir}/${req.files.fmu.name}` // <- field name `fmu` only assumed!
  await fs.ensureDir(tmpDir)
  await fs.writeFile(tmpFile, req.files.fmu.data) // <- field name `fmu` only assumed!

  // Create internal representation by instantiating class `Model`
  const model = await Model.init(req, tmpFile, cfg.fs, celeryClient)

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
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

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
        modelURI: _.join(_.slice(_.split(thisURL, '/'), 0, -1), '/')
      })
    }
  })
}

async function createModelInstance (c, req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host

  const requestBody = req.body
  const mimetype = _.get(req, ['headers', 'content-type'])

  const modelId = _.nth(_.split(req.path, '/'), 2)
  const modelInstanceId = uuid.v4()
  const modelURL = `${origin}/models/${modelId}`

  // Parse request body
  let instanceRepresentation = {}
  switch (mimetype) {
    case 'application/trig':
    case 'application/ld+json':
      instanceRepresentation = await instanceRepresentationFromRDF(
        requestBody,
        mimetype
      )
      break
    default:
      instanceRepresentation = {
        model: {
          href: modelURL,
          id: modelId
        },
        parameterSet: requestBody.parameters
      }
  }

  // Save internal representation of new model instance to cache
  modelInstanceCache.set(modelInstanceId, instanceRepresentation)
  knownModelInstances.push(modelInstanceId)

  // Immediately return `201 Created` with corresponding `Location`-header
  const instanceURL = `${origin}/models/${modelId}/instances/${modelInstanceId}`
  res.format({
    'application/trig': function () {
      res
        .status(201)
        .location(instanceURL)
        .send(
          `@prefix sms: <${knownPrefixes.sms}> .
         <${instanceURL}> a sms:ModelInstance ;
             sms:instanceOf <${modelURL}> .`
        )
    },

    'application/json': function () {
      res
        .status(201)
        .location(instanceURL)
        .json()
    }
  })
}

async function getModelInstance (c, req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  const modelInstanceId = _.last(_.split(req.url, '/'))
  const modelInstance = modelInstanceCache.get(modelInstanceId)

  const instanceRepresentationJSON = {
    modelId: modelInstance.model.id,
    modelHref: modelInstance.model.href,
    parameters: modelInstance.parameterSet
  }

  if (modelInstance === undefined) {
    if (_.includes(knownModelInstances, modelInstanceId)) {
      await responseUtils.respondWithGone(c, req, res)
    } else {
      await responseUtils.respondWithNotFound(c, req, res)
    }
  } else {
    res.format({
      'application/trig': function () {
        res.status(200).render('resources/model_instance.trig.jinja', {
          fmi_url: knownPrefixes.fmi,
          sms_url: knownPrefixes.sms,
          api_url: `${origin}/vocabulary#`,
          base_url: thisURL,
          base_separator: '/'
        })
      },
      'application/json': function () {
        res.status(200).json(instanceRepresentationJSON)
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
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  const requestBody = req.body
  const mimetype = _.get(req, ['headers', 'content-type'])

  // Parse request body to internal representation
  let simulation
  switch (mimetype) {
    case 'application/ld+json':
    case 'application/trig':
      simulation = await simulationRepresentationFromRDF(requestBody, mimetype)
      break
    default:
      simulation = requestBody
  }

  // Amend request body with additional required information to build task signature
  const modelInstanceId = _.nth(_.split(req.path, '/'), 4)
  const modelInstance = modelInstanceCache.get(modelInstanceId)
  const taskRepresentation = {
    modelInstanceId: modelInstanceId,
    simulationParameters: simulation.simulationParameters,
    inputTimeseries: simulation.inputTimeseries,
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
  knownExperiments.push(experimentId)
  experimentCache.set(experimentId, {
    setup: requestBody, // XXX assumes JSON-body
    simulationResult: null
  })

  // Immediately return `201 Created` with corresponding `Location`-header
  const instanceURL = _.join(_.slice(_.split(thisURL, '/'), 0, -1), '/')
  const experimentURL = `${thisURL}/${experimentId}`
  res.format({
    'application/trig': function () {
      res
        .status(201)
        .location(experimentURL)
        .send(
          `@prefix sms: <${knownPrefixes.sms}> .
         <${experimentURL}> a sms:Simulation ;
             sms:simulates <${instanceURL}> .`
        )
    },

    'application/json': function () {
      res
        .status(201)
        .location(experimentURL)
        .json()
    }
  })
}

async function getExperimentStatus (c, req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  const experimentId = _.last(_.split(req.url, '/'))
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

    res.format({
      'application/trig': function () {
        res.status(200).render('resources/simulation.trig.jinja', {
          fmi_url: knownPrefixes.fmi,
          sms_url: knownPrefixes.sms,
          api_url: `${origin}/vocabulary#`,
          base_url: thisURL,
          base_separator: '/'
        })
      },

      'application/json': function () {
        res.status(200).json(setup)
      }
    })
    req.log.info(
      { res: res },
      `successfully handled ${req.method}-request on ${req.path}`
    )
  }
}

async function getExperimentResult (c, req, res) {
  const host = _.get(req, ['headers', 'host'])
  const protocol = _.get(req, ['protocol'])
  const origin = protocol + '://' + host
  const thisURL = `${origin}${req.path}`

  const experimentId = _.nth(_.split(req.url, '/'), -2)
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

    res.format({
      'application/trig': function () {
        res.status(200).render('resources/simulation_result.trig.jinja', {
          api_url: `${origin}/vocabulary#`,
          base_url: thisURL,
          sms_url: knownPrefixes.sms,
          simulation_url: _.replace(thisURL, '/result', ''),
          observations: '/behaviour/quantity/observations',
          feature_of_interest: '/behaviour',
          property: '/behaviour/quantity'
        })
      },

      'application/json': function () {
        res.status(200).json(resultBody)
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
