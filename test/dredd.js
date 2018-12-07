// Use [Dredd](https://github.com/apiaryio/dredd) for validating implementation
// against API specification

'use strict'

const Dredd = require('dredd')

// Load configuration
const SERVER_URL = process.env.SIMAAS_INSTANCE

// Accept self-signed certificates
// https://github.com/apiaryio/dredd/issues/913#issuecomment-381419699
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

// Global variables
const dreddConfig = {
  server: SERVER_URL,
  options: {
    path: [
      './specifications/simaas_oas2_flat.json'
    ],
    hookfiles: [
      './test/dredd_hooks.js'
    ],
    sorted: true,
    reporter: [
      'html'
    ],
    output: [
      './test/dredd_report.html'
    ],
    level: 'verbose',
    silence: false,
    color: true
  }
}

const dredd = new Dredd(dreddConfig)

// Define main function
const main = async function () {
  dredd.run(function (err, stats) {
    if (err !== null) {
      console.log('"err" !== null: ', err)
      process.exit(1)
    } else {
      console.log(stats)
    }
  })
}

// Enter main() if executed as script
if (require.main === module) {
  main()
}
