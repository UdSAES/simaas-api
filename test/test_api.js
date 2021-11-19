// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

const _ = require('lodash')
const fs = require('fs-extra')
const url = require('url')
const axios = require('axios')
const chai = require('chai')
const assert = chai.assert
const it = require('mocha').it
const describe = require('mocha').describe
const { fstat } = require('fs')

const API_ORIGIN = process.env['API_ORIGIN']

describe('Verify behaviour of API-instance', function () {
  const instanceURL = new url.URL(API_ORIGIN)

  const tests = [
    {
      method: 'GET',
      path: '',
      accept: 'application/trig',
      body: null,
      expected: {
        statusCode: 200,
        'content-type': 'application/trig'
      }
    },
    {
      method: 'POST',
      path: 'models/6157f34f-f629-484b-b873-f31be22269e1/instances',
      accept: 'application/json',
      body: fs.readJSONSync(
        'test/data/6157f34f-f629-484b-b873-f31be22269e1/instantiation.json'
      ),
      expected: {
        statusCode: 201,
        'content-type': 'application/json'
      }
    }
  ]

  _.forEach(tests, function (test) {
    const testTitle = `${test.method} ${test.path} as \`${test.accept}\``
    const expectation = `should return \`${test.expected.statusCode}\`
      as \`${test.expected['content-type']}\``

    describe(testTitle, function () {
      const options = {
        url: test.path,
        method: test.method,
        headers: {
          accept: test.accept,
          'content-type': test.accept
        },
        data: test.body,
        isStream: false,
        baseURL: instanceURL.origin
      }

      let response

      before(async function () {
        try {
          response = await axios(options)
        } catch (error) {
          console.error(error)
        }
      })

      it(expectation, function () {
        assert.equal(response.status, test.expected.statusCode)
        assert.include(response.headers['content-type'], test.expected['content-type'])
      })
    })
  })
})
