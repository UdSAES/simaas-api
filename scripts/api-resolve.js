// Resolve $ref-entries in JSON schemata, file ./specifications/simaas_oas2.json

'use strict'

// Load modules
const fs = require('fs-extra')
const $refParser = require('json-schema-ref-parser')

// Do resolve $ref-entries in JSON schemata
async function $refResolve (schema) {
  let schemaFlat = null

  try {
    schemaFlat = await $refParser.dereference(schema)
    console.log('successfully resolved $ref-entries in JSON schema')
  } catch (error) {
    console.log('failed to resolve $ref-entries in JSON schema')
    console.log(error)
    process.exit(1)
  }
  return schemaFlat
}

// Main function
async function main () {
  const schemaPath = './specifications/simaas_oas2.json'
  const schemaPathFlat = './specifications/simaas_oas2_flat.json'
  let schema = null
  let schemaFlat = null

  try {
    schema = await fs.readJson(schemaPath, { encoding: 'utf8' })
    schemaFlat = await $refResolve(schema)
    await fs.writeJson(schemaPathFlat, schemaFlat, {
      spaces: 4,
      encoding: 'utf8'
    })
    console.log('successfully flattened the specification')
  } catch (error) {
    console.log('failed to flatten the specification')
    console.log(error)
    process.exit(1)
  }
}

// Execute as independent script
if (require.main === module) {
  main()
}
