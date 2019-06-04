# API Version History
The API is versioned using [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) (semver) and follows the semver specification.

## Overview
Version   | Date       | Notes
---       | ---        | ---
0.1.0     |            |
0.2.0     |            |
0.3.0     |            |
0.4.0     |            |
0.5.0     |            |

## Release Notes
Details about each release _and_ the features being worked on in reverse order (most recent first).

### v0.5.0
#### User Stories
* [ ] As a user, I want to add new instances of the supported models/model types
* [ ] As a user, I want to retrieve a list of available model instances
* [ ] As a user, I want to retrieve a representation of a specific model instance

#### Endpoints

#### Representations

#### Testing Strategy

#### Housekeeping

#### To Taiga
Hinzufügen Modellinstanzen implementieren
Lesen Definition Experiment implementieren
Zusammenarbeit/Aufgabenteilung `simulation aas` -- `models aas` fundiert definieren
Zusammenarbeit/Aufgabenteilung `simulation aas` -- `models aas` implementieren


### v0.4.0

#### User Stories
* [ ] As a devops-engineer, I expect that relevant information is logged according to specification
    * [ ] As a devops-engineer, I want to specify the log level via the environment
    * [ ] As a devops-engineer, I want to search for requests via indexed fields (instead of parsing messages)
    * [ ] As a devops-engineer, I want to be able to trace requests across microservices
    * [ ] __POP STASH @ 9656da740b8d84745fa84eebe26d1920318f6788__
* [ ] As a devops-engineer, I want to properly separate API, message broker, worker and result storage
    * [ ] As a developer, I want to use an established implementation of a distributed task queue instead of a shaky prototype
    * [ ] As a developer, I want to make use of the excellent packages for scientific computing available in Python
    * [ ] As a developer, I no longer want to parse CLI output but use the native data structures directly
* [ ] As the API, I expect the workers to...
    * [ ] adhere to the format for exchanging data via message broker/result backend that has been agreed upon
    * [ ] consume valid input that has _not_ been preprocessed
    * [ ] execute a given FMU 2.0 for CS and return the simulation result
    * [ ] provide auxiliary information based on the metadata of the FMU
* [ ] As a user, I expect the API to adhere to standard HTTP-semantics
* [ ] As a developer of SUCH, I expect the OAS to be nice to my code generator

#### Data/Model Management
* [ ] is it really a good idea to assume that the JSON representation of resource state exposed via the API is a good format for passing data to workers?
* [ ] how to ensure that all workers have access to the FMUs, potentially even across a swarm?

#### Testing Strategy
* [ ] unit tests for worker tasks
    * [ ] test that parameters like `epochOffset` are correctly set
* [ ] functional tests for enqueuing tasks and retrieving results
* [ ] API-tests using _an up-to-date version_ of Dredd

#### Housekeeping
* [ ] tag & release v0.3.0, merge into branch master
* [ ] use ansible to deploy locally while developing?
* [ ] do not show startup-script in README
* [ ] archive deprecated software-libraries (logger, queue, ...)
* [ ] check satisfaction of external requirements?


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
