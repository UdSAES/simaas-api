# API Version History
The API is versioned using [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) (semver) and follows the semver specification.

## Overview
Version   | Date       | Notes
---       | ---        | ---
0.1.0     |            |
0.2.0     |            |
0.3.0     |            |

## Release Notes
Details about each release _and_ the features being worked on in reverse order (most recent first).

## v0.4.0
### User Stories
* [ ] As a user, I want to add new instances of the supported models/model types
* [ ] As a user, I want to retrieve a list of available model instances
* [ ] As a user, I want to retrieve a representation of a specific model instance

### To Taiga
* Hinzufügen Modellinstanzen implementieren
* Lesen Definition Experiment implementieren
* Zusammenarbeit/Aufgabenteilung `simulation aas` -- `models aas` fundiert definieren
* Zusammenarbeit/Aufgabenteilung `simulation aas` -- `models aas` implementieren


### v0.3.0
* specific to model instance representing a fictive 15kWp PV plant in Saarbrücken
    * replace parameter set, example required to run simulation
    * replace FMU in deployment
* new features
    * explicitly stated requirements
    * restructuring API: get rid of verb _simulate_ in API
    * enfore linting of source code and OAS
    * enforce automatic testing of implementation against OAS
    * structure 4xx/5xx-responses according to RFC7807
    * add all envisioned endpoints, but return `501`
    * secure inputs by specifying regex/minima/maxima/...
    * ensure that request/response validation actually work
    * revise npm run scripts
* bugfixes/housekeeping

#### User Stories
* [x] As a user, I want to trigger simulations of the available model instances
* [x] As a user, I want to retrieve the results of a simulation
* [x] As a user, I want to get `400 Bad Request`-responses if send malformed requests
* [x] As a user, I want to get `404 Not Found`-responses if I request sth. non-existent
* [x] As a user, I want to get `501 Not Implemented`-responses for all endpoints that are not yet implemented

#### Endpoints
* [x] ~~`GET    /model-instances`~~
* [x] ~~`POST   /model-instances`~~
* [x] ~~`GET    /model-instances/{uuid}`~~
* [x] ~~`DELETE /model-instances/{uuid}`~~
* [x]   `POST   /experiments` {body according to fixed schema for one supported model (instance?)}
* [x] ~~`GET    /experiments/{uuid}`~~
* [x]   `GET    /experiments/{uuid}/status`
* [x]   `GET    /experiments/{uuid}/result`

#### Schemata
* [x] `ModelInstance`
* [x] `ExperimentSetup`
* [x] `ExperimentStatus`
* [x] `ExperimentResult`
* [x] `NotImplemented`

#### Testing Strategy
* [x] Linting of OAS using Speccy (enforced in CI/CD)
* [x] Linting of source code using JavaScript Standard Style (enforced in CI/CD)
* [x] Verification of intended behaviour in case all goes well using Dredd (enforced in CI/CD)
* [x] Verify that microservice returns `4xx` in case schema and/or pattern validation fails
* [x] Verify that microservice returns `404` for non-existent resources
* [x] Verify that microservice returns `501` for resources not yet implemented
* Verification of everything else _not_ automated

### v0.2.0
* specific to instances of `SolarPlantWithInput3Outputs.fmu`
* new features
    * kebab-case resources, camelCase parameters, PascalCase schemata
    * graceful shutdown
    * shutdown on uncaught errors/promise rejections
    * return 4xx, 5xx as JSON
* bugfixes/housekeeping
    * upgrade dependencies
