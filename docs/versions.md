# Version History
Details about each release _and_ the features being worked on in reverse order (most recent first).

## v0.4.0
### User Stories
* [ ] As a user, I want to add new instances of the supported models/model types

### To Taiga
* Hinzufügen Modellinstanzen implementieren
* Lesen Definition Experiment implementieren
* Zusammenarbeit/Aufgabenteilung `simulation aas` -- `models aas` fundiert definieren
* Zusammenarbeit/Aufgabenteilung `simulation aas` -- `models aas` implementieren

## v0.3.0
* specific to model instance representing a fictive 15kWp PV plant in Saarbrücken
* restructuring API: ...

### User Stories
* [ ] As a user, I want to retrieve a list of available model instances
* [ ] As a user, I want to retrieve a representation of a specific model instance
* [x] As a user, I want to trigger simulations of the available model instances
* [x] As a user, I want to retrieve the results of a simulation
* [x] As a user, I want to get `400 Bad Request`-responses if send malformed requests
* [x] As a user, I want to get `404 Not Found`-responses if I request sth. non-existent

### Endpoints
* [ ] `GET    /model-instances`
* [ ] `GET    /model-instances/{cuid}`
* [ ] ~~`DELETE /model-instances/{cuid}`~~
* [x] `POST   /experiments` {body according to fixed schema for one supported model (instance?)}
* [ ] ~~`GET    /experiments/{cuid}`~~
* [x] `GET    /experiments/{cuid}/status`
* [x] `GET    /experiments/{cuid}/result`

### Schemata
* [ ] `ModelInstance`
* [x] `ExperimentSetup`
* [x] `ExperimentStatus`
* [x] `ExperimentResult`
* [x] `NotImplemented`

### Testing Strategy
* Linting of OAS using Speccy (enforced in CI/CD)
* Linting of source code using JavaScript Standard Style (enforced in CI/CD)
* Verification of intended behaviour in case all goes well using Dredd (enforced in CI/CD)
* Verify that microservice returns `4xx` in case schema and/or pattern validation fails
* Verify that microservice returns `404` for non-existent resources
* Verification of everything else _not_ automated

### Internal Todos
* important
    * [x] write down requirements in commonmark
    * [x] define testing strategy
    * [ ] check README for completeness
        * [ ] explain mitigation of timeouts/refer to documentation?
* less important
    * [ ] possible to overwrite default rules speccy?
    * [ ] enforce kebab-case for resources and camelCase for identifiers via speccy rules?
    * [ ] think about whether or not the repository should be restructured (modules, `tests`)
    * [ ] refactor experiment/simulation for the sake of consistency?

## v0.2.0
* specific to instances of `SolarPlantWithInput3Outputs.fmu`
* kebab-case resources, camelCase parameters, PascalCase schemata
* graceful shutdown
* shutdown on uncaught errors/promise rejections
* return 4xx, 5xx as JSON
* upgrade dependencies
