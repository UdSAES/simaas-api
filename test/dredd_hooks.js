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
  MODEL_INSTANCES_SIMULATE_SUCCESS: 'Experiments > /experiments > Trigger the simulation of a model instance by defining an experiment > 202',
  EXPERIMENT_STATUS_SUCCESS: 'Experiments > /experiments/{uuid}/status > A resource indicating the status of an experiment > 200 > application/json',
  EXPERIMENT_RESULT_SUCCESS: 'Experiments > /experiments/{uuid}/result > The results of performing the experiment/simulation > 200 > application/json'
}

// Create response stash for passing data between test steps
let responseStash = {}

// Ensure that mediatype is properly handled
// https://github.com/apiaryio/dredd-example/blob/master/openapi2/hooks.js#L42
hooks.beforeEach((transaction, done) => {
  // Accept definition of charset
  // -- XXX careful, this means accepting a deviation from the specification!
  if (transaction.expected.statusCode === '202') {
    delete transaction.expected.headers['Content-Type']
  } else {
    transaction.request.headers['Accept'] = 'application/json'
    transaction.expected.headers['Content-Type'] = 'application/json; charset=utf-8'
  }

  const transactionID = _.replace(
    transaction.id,
    transaction.fullPath,
    transaction.protocol + '//' + transaction.host + ':' + transaction.port + transaction.fullPath
  )

  transaction.id = transactionID

  done()
})

// Retrieve UUID of newly created experiment
hooks.after(STEPS.MODEL_INSTANCES_SIMULATE_SUCCESS, async function (transaction, done) {
  await delay(3000) // give the simulation 3 seconds to finish

  responseStash[transaction.name] = transaction.real // HTTP response to stash
  done()
})

// Use UUID for checking /experiments/{uuid}/status
hooks.before(STEPS.EXPERIMENT_STATUS_SUCCESS, function (transaction) {
  if (responseStash[STEPS.MODEL_INSTANCES_SIMULATE_SUCCESS].statusCode === 202) {
    const experimentStatusURL = url.parse(responseStash[STEPS.MODEL_INSTANCES_SIMULATE_SUCCESS].headers.location)
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

hooks.after(STEPS.EXPERIMENT_STATUS_SUCCESS, function (transaction) {
  if (transaction.skip === false) {
    const status = JSON.parse(transaction.real.body).status
    if (status !== 'DONE') {
      transaction.fail = 'Fail ' + STEPS.EXPERIMENT_RESULT_SUCCESS + ' because status is not "DONE"'
    } else {
      responseStash[transaction.name] = transaction.real // HTTP response to stash
    }
  }
})

// Use UUID for checking /experiments/{uuid}/result
hooks.before(STEPS.EXPERIMENT_RESULT_SUCCESS, function (transaction) {
  if (responseStash[STEPS.EXPERIMENT_STATUS_SUCCESS] !== undefined) {
    const experimentStatus = JSON.parse(responseStash[STEPS.EXPERIMENT_STATUS_SUCCESS].body)
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
      const experimentStatusURL = url.parse(responseStash[STEPS.MODEL_INSTANCES_SIMULATE_SUCCESS].headers.location)
      const transactionID = _.replace(
        transaction.id,
        transaction.fullPath,
        _.replace(experimentStatusURL.href, 'status', 'result')
      )

      transaction.id = transactionID
      transaction.fullPath = experimentStatusURL.pathname

      // transaction.skip = true
      transaction.fail = 'Fail ' + STEPS.EXPERIMENT_RESULT_SUCCESS + ' because property `linkToResult` did not exist'
    }
  } else {
    transaction.skip = true
  }
})
