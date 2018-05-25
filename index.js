'use strict'

const express = require('express')
const {URL} = require('url')
var bodyParser = require('body-parser')
require('express-async-errors')
const cors = require('cors')
const _ = require('lodash')
const request = require('request-promise-native')
const swaggerTools = require('swagger-tools')
const $RefParser = require('json-schema-ref-parser')
const fs = require('fs-extra')

const ASYNC_API_HOST = '127.0.0.1:22345'
const LISTEN_PORT = process.env.LISTEN_PORT || 22346
const API_SPECIFICATION_FILE_PATH = './specifications/simaas_oas2.json'

if (!(_.isNumber(LISTEN_PORT) && LISTEN_PORT > 0 && LISTEN_PORT < 65535)) {
  console.log('LISTEN_PORT is ' + LISTEN_PORT + ' but must be an integer number larger than 0 and smaller than 65535')
  process.exit(1)
}

const app = express()
app.use(bodyParser.json())
app.use(cors())


app.post('/model_instances/:model_instance_id/_simulate', async (req, res) => {
  const model_instance_id = _.get(req, ['params', 'model_instance_id'])
  const simulation_parameters = _.get(req, ['body', 'simulation_parameters'])
  const input_timeseries = _.get(req, ['body', 'input_timeseries'])
  
  const host = _.get(req, ['headers', 'host'])
  let postTaskResult = null
  try {
    postTaskResult = await request({
      url: 'http://' + ASYNC_API_HOST + '/tasks',
      method: 'post',
      json: true,
      resolveWithFullResponse: true,
      body: {
        model_instance_id: model_instance_id,
        simulation_parameters: simulation_parameters,
        input_timeseries: input_timeseries
      }
    })
  } catch (error) {
    res.status(500).send(error.toString())
    return
  }

  if (postTaskResult.statusCode !== 202) {
    res.status(500).send(postTaskResult.statusCode + '')
    return
  }

  const sourceLocationHeader = _.get(postTaskResult, ['headers', 'location'])
  const u = new URL(sourceLocationHeader, 'http://127.0.0.1')
  
  res.status(202).location('http://' + host + u.pathname.replace('/tasks/','/experiments/')).send()
})

app.get('/experiments/:experiment_id/status', async (req, res) => {
  const experiment_id = _.get(req, ['params', 'experiment_id'])
  const host = _.get(req, ['headers', 'host'])
  
  let postTaskResult = null
  try {
    postTaskResult = await request({
      url: 'http://' + ASYNC_API_HOST + '/tasks/' + experiment_id + '/status',
      method: 'get',
      json: true,
      resolveWithFullResponse: true
    })
  } catch (error) {
    res.status(500).send(error.toString())
    return
  }

  const sourceLinkToResult = _.get(postTaskResult, ['body', 'link_to_result'])
  let targetLinkToResult = null
  const resultBody = postTaskResult.body
  
  if (_.isString(sourceLinkToResult)) {
    const u = new URL(sourceLinkToResult, 'http://127.0.0.1')
    targetLinkToResult = 'http://' + host + u.pathname.replace('/tasks/', '/experiments/')
    resultBody.link_to_result = targetLinkToResult
  }

  res.status(200).send(resultBody)
})

app.get('/experiments/:experiment_id/result', async (req, res) => {
  const experiment_id = _.get(req, ['params', 'experiment_id'])
  const host = _.get(req, ['headers', 'host'])
  let postTaskResult = null
  try {
    postTaskResult = await request({
      url: 'http://' + ASYNC_API_HOST + '/tasks/' + experiment_id + '/result',
      method: 'get',
      json: true,
      resolveWithFullResponse: true
    })
  } catch (error) {
    res.status(500).send(error.toString())
    return
  }

  const resultBody = postTaskResult.body
  res.status(200).send(resultBody)
})

async function init() {

  let api = await fs.readJson(API_SPECIFICATION_FILE_PATH, {
    encoding: 'utf8'
  })
  api = await $RefParser.dereference(api)

  swaggerTools.initializeMiddleware(api, function (middleware) {
    // Interpret Swagger resources and attach metadata to request - must be first in swagger-tools middleware chain
    app.use(middleware.swaggerMetadata())

    // Validate Swagger requests
    app.use(middleware.swaggerValidator())

    app.listen(LISTEN_PORT, function () {
      console.log('Now listening on port ' + LISTEN_PORT)
    })
  })
}

init()
