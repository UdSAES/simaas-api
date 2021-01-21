'use strict'

// Load modules and constants
const _ = require('lodash')
const fs = require('fs-extra')

const API_SPECIFICATION_FILE_PATH = './oas/simaas_oas2.json'
const API_SPECIFICATION_FILE_PATH_FLAT = './oas/simaas_oas2_flat.json'

// Define utility functions for API
async function respondWithNotImplemented (req, res) {
  res.set('Content-Type', 'application/problem+json')
  res.status(501).json({
    'title': 'Not Implemented',
    'status': 501,
    'detail': 'The request was understood, but the underlying implementation is not available yet.'
  })
  req.log.info({ res: res }, `successfully handled ${req.method}-request on ${req.path}`)
}

async function serveOAS (req, res) {
  let flatVersionWanted
  let oas

  if (_.has(req.query, 'flat') === true) {
    flatVersionWanted = req.query.flat
  } else {
    flatVersionWanted = true
  }

  if (flatVersionWanted === true) {
    oas = await fs.readJson(API_SPECIFICATION_FILE_PATH_FLAT, { encoding: 'utf8' })
  } else {
    oas = await fs.readJson(API_SPECIFICATION_FILE_PATH, { encoding: 'utf8' })
  }

  res.status(200).json(oas)
}

exports.respondWithNotImplemented = respondWithNotImplemented
exports.serveOAS = serveOAS
