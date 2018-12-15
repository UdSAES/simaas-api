// Hooks for testing the implementation against the API description with Dredd

'use strict'

const _ = require('lodash')
const url = require('url')
const hooks = require('hooks')
const delay = require('delay')

// [moritz@autsys138 api]$ ./node_modules/dredd/bin/dredd ./oas/simaas_oas2_flat.json $SIMAAS_INSTANCE --names
// info: Experiments > /experiments > Trigger the simulation of a model instance by defining an experiment > 202
// info: Experiments > /experiments/{uuid}/status > A resource indicating the status of an experiment > 200 > application/json
// info: Experiments > /experiments/{uuid}/result > The results of performing the experiment/simulation > 200 > application/json
const STEPS = {
  GET_MODEL_INSTANCES_501: 'Model Instances > /model-instances > A list of all available model instances > 501 > application/problem+json',
  POST_MODEL_INSTANCES_501: 'Model Instances > /model-instances > Instantiate a model for a specific system > 501 > application/problem+json',
  GET_MODEL_INSTANCE_UUID_400: 'Model Instances > /model-instances/{uuid} > A specific model instance > 400 > application/problem+json',
  GET_MODEL_INSTANCE_UUID_501: 'Model Instances > /model-instances/{uuid} > A specific model instance > 501 > application/problem+json',
  DELETE_MODEL_INSTANCE_UUID_501: 'Model Instances > /model-instances/{uuid} > Delete a specific model instance > 501 > application/problem+json',
  GET_EXPERIMENTS_501: 'Experiments > /experiments > A list of all available experiments > 501 > application/problem+json',
  POST_EXPERIMENTS_202: 'Experiments > /experiments > Trigger the simulation of a model instance by defining an experiment > 202 > application/json',
  GET_EXPERIMENT_UUID_501: 'Experiments > /experiments/{uuid} > A specific experiment > 501 > application/problem+json',
  GET_EXPERIMENT_UUID_STATUS_200: 'Experiments > /experiments/{uuid}/status > A resource indicating the status of an experiment > 200 > application/json',
  GET_EXPERIMENT_UUID_RESULT_200: 'Experiments > /experiments/{uuid}/result > The results of performing the experiment/simulation > 200 > application/json',
  GET_NOT_FOUND_404: 'Unsuccessful Operations > /notfound > A resource that does not exist > 404 > application/problem+json'
}

// Create response stash for passing data between test steps
let responseStash = {}

// Ensure that mediatype is properly handled
// https://github.com/apiaryio/dredd-example/blob/master/openapi2/hooks.js#L42
hooks.beforeEach((transaction, done) => {
  // Accept definition of charset
  // -- XXX careful, this means accepting a deviation from the specification!
  transaction.expected.headers['Content-Type'] += '; charset=utf-8'

  const transactionID = _.replace(
    transaction.id,
    transaction.fullPath,
    transaction.protocol + '//' + transaction.host + ':' + transaction.port + transaction.fullPath
  )

  transaction.id = transactionID

  done()
})

// Activate verification of non-2xx responses //////////////////////////////////
// https://dredd.org/en/latest/how-to-guides.html?highlight=skip#id13
hooks.before(STEPS.GET_MODEL_INSTANCES_501, function (transaction) {
  transaction.skip = false
})

hooks.before(STEPS.POST_MODEL_INSTANCES_501, function (transaction) {
  transaction.skip = false
})

// Verify that failed schema validation results in `400 Bad Request`
hooks.before(STEPS.GET_MODEL_INSTANCE_UUID_400, function (transaction) {
  const patternUUIDv4 = /[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-4[0-9A-Za-z]{3}-[89ABab][0-9A-Za-z]{3}-[0-9A-Za-z]{12}/
  transaction.fullPath = transaction.fullPath.replace(patternUUIDv4, 'asdf')
  transaction.skip = false
})

hooks.before(STEPS.GET_MODEL_INSTANCE_UUID_501, function (transaction) {
  transaction.skip = false
})

hooks.before(STEPS.DELETE_MODEL_INSTANCE_UUID_501, function (transaction) {
  transaction.skip = false
})

hooks.before(STEPS.GET_EXPERIMENTS_501, function (transaction) {
  transaction.skip = false
})

hooks.before(STEPS.GET_EXPERIMENT_UUID_501, function (transaction) {
  transaction.skip = false
})

hooks.before(STEPS.GET_NOT_FOUND_404, function (transaction) {
  transaction.skip = false
})

// Modify Dredd-requests to ensure their correctness ///////////////////////////
hooks.before(STEPS.POST_EXPERIMENTS_202, function (transaction) {
  delete transaction.expected.headers['Content-Type']
})

// Retrieve UUID of newly created experiment
hooks.after(STEPS.POST_EXPERIMENTS_202, async function (transaction, done) {
  await delay(3000) // give the simulation 3 seconds to finish

  responseStash[transaction.name] = transaction.real // HTTP response to stash
  done()
})

// Use UUID for checking /experiments/{uuid}/status
hooks.before(STEPS.GET_EXPERIMENT_UUID_STATUS_200, function (transaction) {
  if (responseStash[STEPS.POST_EXPERIMENTS_202].statusCode === 202) {
    const experimentStatusURL = url.parse(responseStash[STEPS.POST_EXPERIMENTS_202].headers.location)
    const transactionID = _.replace(
      transaction.id,
      transaction.protocol + '//' + transaction.host + ':' + transaction.port + transaction.fullPath,
      experimentStatusURL.href
    )

    transaction.id = transactionID
    transaction.fullPath = experimentStatusURL.pathname
  } else {
    transaction.skip = true
  }
})

hooks.after(STEPS.GET_EXPERIMENT_UUID_STATUS_200, function (transaction) {
  if (transaction.skip === false) {
    const status = JSON.parse(transaction.real.body).status
    if (status !== 'DONE') {
      transaction.fail = 'Fail ' + STEPS.GET_EXPERIMENT_UUID_RESULT_200 + ' because status is not "DONE"'
    } else {
      responseStash[transaction.name] = transaction.real // HTTP response to stash
    }
  }
})

// Use UUID for checking /experiments/{uuid}/result
hooks.before(STEPS.GET_EXPERIMENT_UUID_RESULT_200, function (transaction) {
  if (responseStash[STEPS.GET_EXPERIMENT_UUID_STATUS_200] !== undefined) {
    const experimentStatus = JSON.parse(responseStash[STEPS.GET_EXPERIMENT_UUID_STATUS_200].body)
    if ('linkToResult' in experimentStatus) {
      const experimentResultURL = url.parse(experimentStatus['linkToResult'])
      const transactionID = _.replace(
        transaction.id,
        transaction.protocol + '//' + transaction.host + ':' + transaction.port + transaction.fullPath,
        experimentResultURL.href
      )
      transaction.id = transactionID
      transaction.fullPath = experimentResultURL.pathname
    } else {
      // Correct transaction.id, but still fail the test
      const experimentStatusURL = url.parse(responseStash[STEPS.POST_EXPERIMENTS_202].headers.location)
      const transactionID = _.replace(
        transaction.id,
        transaction.fullPath,
        _.replace(experimentStatusURL.href, 'status', 'result')
      )

      transaction.id = transactionID
      transaction.fullPath = experimentStatusURL.pathname

      // transaction.skip = true
      transaction.fail = 'Fail ' + STEPS.GET_EXPERIMENT_UUID_RESULT_200 + ' because property `linkToResult` did not exist'
    }
  } else {
    transaction.skip = true
  }
})
