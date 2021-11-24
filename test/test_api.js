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
const before = require('mocha').before
const describe = require('mocha').describe

const API_ORIGIN = process.env.API_ORIGIN

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 1000))
}

describe('Verify non-functional behaviour of API-instance', function () {
  const instanceURL = new url.URL(API_ORIGIN)

  const tests = [
    {
      functionality: 'getRESTdesc',
      method: 'OPTIONS',
      path: '',
      accept: '*/*',
      body: null,
      expected: {
        statusCode: 200,
        'content-type': 'text/n3'
      }
    },
    {
      functionality: 'getRoot',
      method: 'GET',
      path: '/',
      accept: 'application/trig',
      body: null,
      expected: {
        statusCode: 200,
        'content-type': 'application/trig'
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

describe('Test API functionality wrt expected status codes', function () {
  const instanceURL = new url.URL(API_ORIGIN)

  const serializations = {
    'application/json': {
      ext: 'json',
      reader: fs.readJSONSync
    }
  }

  _.forEach(serializations, function (v, k) {
    const testAddendum = `using \`${k}\` as input`

    describe(`Instantiate model; ${testAddendum}...`, function () {
      const modelId = '6157f34f-f629-484b-b873-f31be22269e1'

      let instantiationResponse
      let simulationResponse
      let simulationState
      let resultResponse
      let resultLocation

      before(async function () {
        // Add model instance
        instantiationResponse = await axios({
          baseURL: instanceURL.origin,
          url: `models/${modelId}/instances`,
          method: 'POST',
          headers: {
            accept: k,
            'content-type': k
          },
          data: v.reader(`test/data/${modelId}/instantiation.${v.ext}`, {
            encoding: 'utf-8'
          })
        })

        console.log(`\nAdding model instance...
          -> Status: ${instantiationResponse.status}
          -> Location: ${instantiationResponse.headers.location}
        `)

        // Trigger simulation
        simulationResponse = await axios({
          url: `${instantiationResponse.headers.location}/experiments`,
          method: 'POST',
          headers: {
            accept: k,
            'content-type': k
          },
          data: v.reader(`test/data/${modelId}/simulation.${v.ext}`, {
            encoding: 'utf-8'
          })
        })

        console.log(`\nTriggering simulation...
          -> Status: ${simulationResponse.status}
          -> Location: ${simulationResponse.headers.location}
        `)

        // Get simulation status
        const sleepForXms = 500
        const maxIterations = 10
        for (let i = 0; i < maxIterations; i++) {
          simulationState = await axios({
            url: simulationResponse.headers.location,
            method: 'GET',
            headers: {
              accept: k,
              'content-type': k
            }
          })

          if (k === 'application/json') {
            if (_.has(simulationState.data, 'linkToResult')) {
              console.log(`\nQuerying simulation state...
            -> Status: ${simulationState.status}
            -> Location: ${simulationState.data.linkToResult}`)

              resultLocation = simulationState.data.linkToResult
              break
            } else {
              console.log(`\nQuerying simulation state...
            -> Status: ${simulationState.status}
            => Sleeping for ${sleepForXms} ms...`)
              await sleep(sleepForXms)
            }
          } else {
            console.warn(`Can't yet parse non-JSON response!
          => Waiting for 1 s; assuming that the result exists afterwards...`)
            await sleep(1000)
            resultLocation = `${simulationLocation}/result`
            break
          }
        }

        // Get simulation result
        resultResponse = await axios({
          url: resultLocation,
          method: 'GET',
          headers: {
            accept: k,
            'content-type': k
          }
        })

        console.log(`\nRetrieving simulation result...
          -> Status: ${resultResponse.status},
          -> URL: ${resultLocation}
        `)
      })

      it('should return the expected status codes', function () {
        assert.equal(instantiationResponse.status, 201)
        assert.equal(simulationResponse.status, 201)
        assert.equal(simulationState.status, 200)
        assert.equal(resultResponse.status, 200)
      })
    })
  })
})
