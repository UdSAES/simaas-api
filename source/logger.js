// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

// Create logger
// -- `log.<level>()` does _not_ include a request identifier
// -- use req.log.<level>() for including the request id! compare `app.use()`-statement
//    for logging incoming requests, as suggested here:
//    https://github.com/trentm/node-bunyan#logchild (last paragraph)
const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: 'simaas_api', // TODO make configurable?
  stream: process.stdout,
  level: parseInt(process.env.LOG_LEVEL) || bunyan.INFO,
  serializers: {
    err: bunyan.stdSerializers.err,
    req: bunyan.stdSerializers.req,
    res: function (res) {
      if (!res || !res.statusCode) {
        return res
      }
      return {
        statusCode: res.statusCode,
        headers: res._headers
      }
    }
  }
})

module.exports = log // https://stackoverflow.com/a/15356715
