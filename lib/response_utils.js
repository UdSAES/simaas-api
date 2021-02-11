'use strict'

// Load modules and constants
const _ = require('lodash')
const fs = require('fs-extra')
const YAML = require('yaml')

async function readYaml (file, options) {
  const fileContent = await fs.readFile(file, options)
  const yaml = YAML.parse(fileContent)
  return yaml
}

// Define utility functions for API
async function sendProblemDetail (res, config) {
  // `config` is a dictionary containing the fields from RFC 7807
  // field `status` is required; `detail`, `type`, `title`, `instance` are optional
  res.set('Content-Type', 'application/problem+json')
  const statusCode = config.status
  res.status(statusCode).json(config)
}

async function respondWithNotImplemented (c, req, res, next) {
  await sendProblemDetail(res, {
    title: 'Not Implemented',
    status: 501,
    detail:
      'The request was understood, but the underlying implementation is not available yet.'
  })
  req.log.info(
    `sent \`501 Not Implemented\` as response to ${req.method}-request on ${req.path}`
  )
}

async function respondWithNotFound (c, req, res, next) {
  await sendProblemDetail(res, {
    title: 'Not Found',
    status: 404,
    detail: 'The requested resource was not found on this server'
  })
  req.log.info(
    'sent `404 Not Found` as response to ' + req.method + '-request on ' + req.path
  )
}

async function failValidation (c, req, res, next) {
  const firstError = c.validation.errors[0]

  await sendProblemDetail(res, {
    title: 'Schema Validation Failed',
    status: 400,
    detail: firstError.message,
    path: firstError.dataPath
  })

  req.log.info('schema validation failed -- request dropped', firstError)
}

async function serveOAS (c, req, res) {
  let flatVersionWanted
  let oas

  if (_.has(req.query, 'flat') === true) {
    flatVersionWanted = (req.query.flat.toLowerCase() === 'true')
  } else {
    flatVersionWanted = true
  }

  if (flatVersionWanted === true) {
    oas = await readYaml('./oas/simaas_oas3_flat.yaml', {
      encoding: 'utf8'
    })
  } else {
    oas = await fs.readJson('./oas/simaas_oas3.json', { encoding: 'utf8' })
  }

  res.status(200).json(oas)
}

exports.sendProblemDetail = sendProblemDetail
exports.respondWithNotImplemented = respondWithNotImplemented
exports.respondWithNotFound = respondWithNotFound
exports.failValidation = failValidation
exports.serveOAS = serveOAS
