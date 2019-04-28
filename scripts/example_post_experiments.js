// Script for updating the exemplary body of POST-request to /experiments

'use strict'

// Load modules
const _ = require('lodash')
const { URL } = require('url')
const request = require('request-promise-native')
const moment = require('moment')
const convertTimeseriesArrayToCsv = require('../simaas_worker').convertTimeseriesArrayToCsv

// Define configuration
const WEATHER_API_ORIGIN = 'https://weather.designetz.saarland'
// const OAS_PATH = '../oas/simaas_oas2.json'

// Define constants
const location = {
  latitude: 49.2553,
  longitude: 7.0405,
  elevation: 273
}

const simulationParameters = {
  startTime: moment.utc('20181117', 'YYYYMMDD').startOf('day').valueOf(), // perfect sunny day
  stopTime: moment.utc('20181117', 'YYYYMMDD').endOf('day').valueOf(),
  outputInterval: 3600
}

// console.log(JSON.stringify(location))
// console.log(JSON.stringify(simulationParameters))

// Define request to weather API
async function getWeatherForecast (voi) {
  let weatherForecast = null
  let requestURL = new URL(
    '/weather/cosmo/d2/' + simulationParameters.startTime + `/` + voi,
    WEATHER_API_ORIGIN
  )
  requestURL.search = 'lat=' + location.latitude + '&lon=' + location.longitude
  // console.log({requestURL: requestURL.href})

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
async function getInputTimeseries () {
  const voi = {
    temperature: 't_2m',
    directHorizontalIrradiance: 'aswdir_s',
    diffuseHorizontalIrradiance: 'aswdifd_s'
  }

  let inputTimeseries = []
  // console.log(inputTimeseries)

  // Object.entries(voi).forEach(async ([key, value]) => {
  //   const forecast = await getWeatherForecast(value)
  //   inputTimeseries[key] = forecast
  // }) XXX function returns before promises are fulfilled, for whatever reason

  for (const [key, value] of Object.entries(voi)) {
    const forecast = await getWeatherForecast(value)
    forecast.label = key
    if (forecast.data.length <= 28) {
      forecast.timeseries = forecast.data.slice(0, 24 + 1)
    } else {
      forecast.timeseries = forecast.data.slice(0, 24 * 4 + 1)

      // What follows is a workaround for the inability of the worker to cope
      // with timeseries of different lenghts --- XXX remove eventually
      _.remove(forecast.timeseries, function (objTsValue) {
        let date = new Date(objTsValue.timestamp)
        return date.getMinutes() !== 0
      })
    }
    // forecast.timeseries = _.map(forecast.timeseries, function (objTsValue) {
    //   objTsValue.timestamp = (objTsValue.timestamp - simulationParameters.startTime) / 1000
    //   return objTsValue
    // }) // 20190427: not necessary anymore!
    delete forecast.data
    delete forecast.location
    inputTimeseries.push(forecast)
  }

  return inputTimeseries
}

async function main () {
  const inputTimeseries = await getInputTimeseries()

  // Construct exemplary body of POST-request to /experiments
  const example = {
    modelInstanceID: 'c02f1f12-966d-4eab-9f21-dcf265ceac71',
    simulationParameters,
    inputTimeseries
  }

  // XXX Inject updated example into OpenAPI-specification?

  console.log(JSON.stringify(example, null, 4))
  console.log(JSON.stringify(example, null, 0))

  // For debugging: export timeseries as .csv for fmpy.gui and as .txt for Dymola
  const csv = convertTimeseriesArrayToCsv(example.inputTimeseries)
  console.log(csv)
}

main()
