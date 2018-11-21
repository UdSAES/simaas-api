// Use [Dredd](https://github.com/apiaryio/dredd) for validating implementation
// against API specification

'use strict'

const Dredd = require('dredd')

// Load configuration
const SERVER_URL = 'http://localhost:3000/'

// Global variables
const dreddConfig = {
  server: SERVER_URL,
  options: {
    path: [
      './specifications/simaas_oas2.json'
    ]
  }
}

const dredd = new Dredd(dreddConfig)

// Define main function
const main = async function () {
  dredd.run(function (err, stats) {
    if (err !== undefined) {
      console.log(err)
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
