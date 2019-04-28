// Use [Dredd](https://github.com/apiaryio/dredd) for validating implementation
// against API specification

'use strict'

const Dredd = require('dredd')

// Load configuration
const SERVER_URL = process.env.SIMAAS_INSTANCE
if (!SERVER_URL) {
  console.log(`SIMAAS_INSTANCE was "${SERVER_URL}", but must be the URL to a running instance`)
  process.exit(1)
}

// Accept self-signed certificates
// https://github.com/apiaryio/dredd/issues/913#issuecomment-381419699
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0

// Global variables
const dreddConfig = {
  server: SERVER_URL,
  options: {
    path: [
      './oas/simaas_oas2_flat.json'
    ],
    hookfiles: [
      './test/dredd_hooks.js'
    ],
    sorted: true,
    level: 'verbose',
    silence: false,
    color: true
  }
}

const dredd = new Dredd(dreddConfig)

// Define main function
const main = async function () {
  dredd.run(function (err, stats) {
    if (err) {
      console.log('There were errors while running Dredd', err)
      process.exit(1)
    } else {
      if ((stats.failures + stats.errors) !== 0) {
        console.log('Implementation does not match OAS -- FAILURE')
        process.exit(1)
      }
      console.log('Ran Dredd successfully!')
    }
  })
}

// Enter main() if executed as script
if (require.main === module) {
  main()
}
