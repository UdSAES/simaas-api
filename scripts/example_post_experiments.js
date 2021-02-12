// Script for updating the exemplary body of POST-request to /experiments
// Also exports that data in the formats required for usage with the GUI of
// fmpy and Dymola

'use strict'

// Load modules
const _ = require('lodash')
const { URL } = require('url')
const fs = require('fs-extra')
const request = require('request-promise-native')
const moment = require('moment')

// Define configuration
const WEATHER_API_ORIGIN = 'https://weather.designetz.saarland'
const NAN_REPR = 'NaN'
// const OAS_PATH = '../oas/simaas_oas2.json'

// Define constants
const locationName = 'saarbruecken'
const location = {
  latitude: 49.2553,
  longitude: 7.0405,
  elevation: 273
}

const voi = {
  temperature: 't_2m',
  directHorizontalIrradiance: 'aswdir_s',
  diffuseHorizontalIrradiance: 'aswdifd_s'
}

const simulationParameters = {
  startTime: moment
    .utc('20181117', 'YYYYMMDD')
    .startOf('day')
    .valueOf(), // perfect sunny day
  stopTime: moment
    .utc('20181117', 'YYYYMMDD')
    .endOf('day')
    .valueOf(),
  outputInterval: 900
}

console.log(JSON.stringify(location))
console.log(JSON.stringify(simulationParameters))

// Define request to weather API
async function getWeatherForecast (voi) {
  let weatherForecast = null
  let requestURL = new URL(
    '/weather/cosmo/d2/' + simulationParameters.startTime + `/` + voi,
    WEATHER_API_ORIGIN
  )
  requestURL.search = 'lat=' + location.latitude + '&lon=' + location.longitude
  console.log({ requestURL: requestURL.href })

  try {
    weatherForecast = await request({
      url: requestURL,
      method: 'get',
      json: true
    })
  } catch (error) {
    console.log(JSON.serialize(error))
    process.exit(1)
  }
  return weatherForecast
}

// Get weather forecasts for relevant variables of interest
async function getInputTimeseries (voi) {
  let inputTimeseries = []

  for (const [key, value] of Object.entries(voi)) {
    const forecast = await getWeatherForecast(value)
    forecast.label = key
    if (forecast.data.length <= 28) {
      forecast.timeseries = forecast.data.slice(0, 24 + 1)
    } else {
      forecast.timeseries = forecast.data.slice(0, 24 * 4 + 1)

      // // What follows is a workaround for the inability of the worker to cope
      // // with timeseries of different lenghts --- XXX remove eventually
      // _.remove(forecast.timeseries, function (objTsValue) {
      //   let date = new Date(objTsValue.timestamp)
      //   return date.getMinutes() !== 0
      // })
    }

    delete forecast.data
    delete forecast.location
    inputTimeseries.push(forecast)
  }

  return inputTimeseries
}

function convertTimeseriesArrayToCsv (
  timeseriesArray,
  columnSeparator,
  stringDelimiter,
  allowNaN
) {
  // Create headers
  const headings = [stringDelimiter + 'time' + stringDelimiter]
  _.forEach(timeseriesArray, (timeseries) => {
    headings.push(stringDelimiter + timeseries.label + stringDelimiter)
  })

  let rows = []
  rows.push(headings.join(columnSeparator))

  // Collect all timestamps at which values are known
  let timestamps = new Set()
  _.forEach(timeseriesArray, (tsObj) => {
    _.forEach(tsObj.timeseries, (te) => {
      timestamps.add(te.timestamp)
    })
  })
  timestamps = Array.from(timestamps)
  timestamps = _.sortBy(timestamps, (v) => {
    return v
  })

  // Push concatenated string of values to array of rows
  _.forEach(timestamps, (uniqueTimestamp) => {
    let row = [String(uniqueTimestamp)]
    _.forEach(timeseriesArray, (tsObj) => {
      let pair = _.find(tsObj.timeseries, (item) => {
        return item.timestamp === uniqueTimestamp
      })
      if (pair === undefined) {
        row.push(NAN_REPR)
      } else {
        row.push(pair.value)
      }
    })
    rows.push(_.join(row, columnSeparator))
  })

  // Drop incomplete rows iff allowNaN is falsy
  if (!allowNaN) {
    rows = _.filter(rows, (row) => {
      return !row.includes(NAN_REPR)
    })
  }

  rows.splice(1, 0, rows[1]) // duplicate first row after header

  return rows.join('\n')
}

async function dymolaInputFromCsv (name, csv, columnSeparator) {
  const arrayOfRows = _.split(csv, '\n')
  let varNames = _.split(arrayOfRows[0], columnSeparator)
  const headerOne = `double ${name}(${arrayOfRows.length - 2},${varNames.length})`
  const headerTwo = _.replace(_.join(varNames, columnSeparator), 'time', '#epoch')
  const content = _.join(arrayOfRows.slice(2), '\n') // drop header AND duplicate line
  const template = `#1
${headerOne}
${headerTwo}
${content}
`

  return template
}

async function main () {
  const inputTimeseries = await getInputTimeseries(voi)

  // Construct exemplary body of POST-request to /experiments
  const example = {
    modelInstanceID: 'c02f1f12-966d-4eab-9f21-dcf265ceac71',
    simulationParameters,
    inputTimeseries
  }

  // XXX Inject updated example into OpenAPI-specification?

  // For debugging: prepare timeseries as .csv for fmpy.gui
  // https://stackoverflow.com/questions/15006287/does-a-javascript-function-return-objects-by-reference-or-value-by-default
  let exampleRelativeTime = _.cloneDeep(example)
  const offset = exampleRelativeTime.inputTimeseries[0].timeseries[0].timestamp // XXX assumes order

  // Let timestamps begin at zero and convert to seconds
  _.forEach(exampleRelativeTime.inputTimeseries, function (tsObject) {
    tsObject.timeseries = _.map(tsObject.timeseries, function (timestampObject) {
      return {
        value: timestampObject.value,
        timestamp: _.round((timestampObject.timestamp - offset) / 1000, 0)
      }
    })
  })

  const csv = convertTimeseriesArrayToCsv(exampleRelativeTime.inputTimeseries, ',', '"')

  // Write results to targets
  const dayOfInterest = moment
    .utc(example.simulationParameters.startTime)
    .format('YYYYMMDD')

  // -- ${dayOfInterest}_req_body_${locationName}.json
  const filenameJson = `./local/${dayOfInterest}_req_body_${locationName}.json`
  await fs.writeJson(filenameJson, example, { spaces: 2, encoding: 'utf8' })
  console.log(
    JSON.stringify({ msg: `examplary request-body written to ${filenameJson}` })
  )

  // -- ${dayOfInterest}_${voiNames}_${locationName}_60min.csv
  const voiNames = _.join(Object.values(voi), '_')
  const filenameCsv = `./local/${dayOfInterest}_${voiNames}_${locationName}_60min.csv`

  await fs.writeFile(filenameCsv, csv, { encoding: 'utf8' })
  console.log(JSON.stringify({ msg: `input timeseries written to ${filenameCsv}` }))

  // -- ${dayOfInterest}_${voiNames}_${locationName}_60min.txt
  const filenameTxt = `./local/${dayOfInterest}_${voiNames}_${locationName}_60min.txt`
  // Convert ms to s
  _.forEach(example.inputTimeseries, function (tsObject) {
    tsObject.timeseries = _.map(tsObject.timeseries, function (item) {
      return {
        value: item.value,
        timestamp: _.round(item.timestamp / 1000, 0)
      }
    })
  })
  const content = await dymolaInputFromCsv(
    locationName,
    convertTimeseriesArrayToCsv(example.inputTimeseries, ' ', ''),
    ' '
  )

  await fs.writeFile(filenameTxt, content, { encoding: 'utf8' })
  console.log(JSON.stringify({ msg: `input timeseries written to ${filenameTxt}` }))
}

main()
