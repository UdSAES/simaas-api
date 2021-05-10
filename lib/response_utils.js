// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

// Define utility functions for API
async function sendProblemDetail (res, config) {
  // `config` is a dictionary containing the fields from RFC 7807
  // field `status` is required; `detail`, `type`, `title`, `instance` are optional
  res.set('Content-Type', 'application/problem+json')
  const statusCode = config.status
  res.status(statusCode).json(config)
}

async function respondWithNotImplemented (c, req, res) {
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

async function respondWithGone (c, req, res) {
  await sendProblemDetail(res, {
    title: 'Gone',
    status: 410,
    detail: 'The requested resource no longer exists on this server.'
  })
  req.log.info(`sent \`410 Gone\` as response to ${req.method}-request on ${req.path}`)
}

async function respondWithNotAcceptable (c, req, res) {
  await sendProblemDetail(res, {
    title: 'Not acceptable',
    status: 406,
    detail: 'The requested (hyper-) media type is not supported for this resource'
  })
  req.log.info(
    'sent `406 Not Acceptable` as response to ' + req.method + '-request on ' + req.path
  )
}

async function respondWithNotFound (c, req, res) {
  await sendProblemDetail(res, {
    title: 'Not Found',
    status: 404,
    detail: 'The requested resource was not found on this server'
  })
  req.log.info(
    'sent `404 Not Found` as response to ' + req.method + '-request on ' + req.path
  )
}

async function failValidation (c, req, res) {
  const firstError = c.validation.errors[0]

  await sendProblemDetail(res, {
    title: 'Schema Validation Failed',
    status: 400,
    detail: firstError.message,
    path: firstError.dataPath
  })

  req.log.info('schema validation failed -- request dropped', firstError)
}

exports.sendProblemDetail = sendProblemDetail
exports.respondWithNotImplemented = respondWithNotImplemented
exports.respondWithGone = respondWithGone
exports.respondWithNotAcceptable = respondWithNotAcceptable
exports.respondWithNotFound = respondWithNotFound
exports.failValidation = failValidation
