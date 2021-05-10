// Script to set the size of the buffer `SCRATCH` to the desired value

// If the size of the task representation enqueued in RabbitMQ using `amqplib` is
// larger than 2**15=65536 bytes, a `RangeError [ERR_OUT_OF_RANGE]: The value of
// \"offset\" is out of range.` is thrown.
//
// * Compare https://github.com/squaremo/amqp.node/issues/366
// * Workaround: change buffer size in `./node_modules/amqplib/lib/defs.js`, line 3080

// SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
// SPDX-License-Identifier: MIT

'use strict'

const _ = require('lodash')
const fs = require('fs-extra')

async function setSizeOfBufferScratch (filepath, size) {
  let source = await fs.readFile(filepath, { encoding: 'utf8' })
  source = _.replace(
    source,
    /SCRATCH = Buffer.alloc\(\d+\)/,
    `SCRATCH = Buffer.alloc(${size})`
  )

  const status = await fs.writeFile(filepath, source, { encoding: 'utf8' })
  return status
}

async function main () {
  const sourceFile = './node_modules/amqplib/lib/defs.js'
  const desiredSize = _.toInteger(process.env.SIMAAS_SCRATCH_BUFFER_SIZE ?? 65536)

  const status = await setSizeOfBufferScratch(sourceFile, desiredSize)
  if (status === undefined) {
    console.log(`Statement changed to \`SCRATCH = Buffer.alloc(${desiredSize})\``)
    process.exit(0)
  } else {
    console.log('Failed to set buffer size!')
    process.exit(1)
  }
}

main()
