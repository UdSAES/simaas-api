# Requirements Simulation as a Service
This microservice is expected to become a number cruncher that responds to all simulation requests thrown at it, even parallel ones, with ease and confidence; scaling across processors and machines dynamically iff necessary. Its basic entities are _model instances_ and _experiments_, which are at first exposed through a REST-based HTTP resource API.

Under the hood, the strength of this microservice lies in the execution engine, which provides both the raw results of a simulation as well as meaningful metadata wherever applicable. Consequently, representing the abilities of "simulation" in terms of resources, verbs and, most importantly, formal representations in a way that intelligent clients can leverage these capabilities is the main challenge from a conceptual point of view. From a technical point of view, the challenge lies in architecting and implementing a robust and decently fast solution that fulfils the stakeholder expectations (_and_ documents that) without getting lost in the plethora of possibilities, especially those for unnecessary optimization offered by shiny, buzzword-heavy libraries/tools.

Over the course of my PhD, this API will evolve into a RESTful hypermedia API fully supporting HATEOAS and integrating with the principles of linked data and the semantic web in general.

## Stakeholder Expectations
The stakeholders of the microservice to be developed are...
* __UdS AES__ as the chair that has to deliver specified results as part of the Designetz-project
* __Westnetz/innogy__ as the company that will run the code in a critical environment
* the __developers at UdS AES__ that have to implement and operate the microservice
* __other microservices__ that hard-code requests against a specific version of the API
* __human users of service instances__ that want to use it as a source of data
* __researchers__ that want to evaluate the service's concept, its architecture, its capabilities, and its performance
* __researchers/developers__ that come across the git-repository and want to build upon and extend the current service implementation, possibly in a few years time
* __me__ (Moritz Stüber) as the PhD student that expects to demonstrate the viability of his research using this microservice (among others)

Although not known for sure and definitely incomplete, these are their non-specific expectations:
* As UdS AES, I expect that...
    * the microservice holds all the promises originally made and documents that explicitly
    * one can find high-level answers to the questions "what/what not?", "why?", "how?", "documented where?", "published where?" and "status?" very quickly
    * one can find up-to-date in-depth documentation that matches the implementation quickly
* As Westnetz/innogy, I expect that...
    * all requirements arising from the assumptions made during risk analysis are indeed met by the developers
    * the developers behave securely, as indicated in the corresponding written elaboration
    * I know about all requirements that are _not_ fulfilled (and the reasons for that)
    * there is documentation about how requirements are implemented
    * there is documentation on how to configure and operate a service instance
    * there is some kind of version history/elaboration on new releases
* As a developer at UdS AES, I expect that...
    * the code base and any instances are fully adhere to the defined devops-processes
    * maintenance and onboarding new developers is straightforward because the _code_ is easy to read
    * the code base is kept clean by proper usage of branches, atomic commits (whenever possible), proper commit messages, and frequent pushing
    * knowledge gained from experimenting is documented appropriately in a timely manner
    * all developers contribute to keeping the README and other documentation up to date
    * the microservices scales across processors and machines dynamically iff necessary
    * measures are taken to prevent regression of the implementation
* As another microservice, I expect that...
    * there are no (sudden/unannounced) backwards-incompatible API changes
    * requests are resolved almost instantly
    * the microservice is always online
    * the microservice doesn't choke on many requests sent at once
* As a human users of a service instance, I expect that...
    * the OAS always matches the implementation exactly
    * the entire interaction with the API happens through the API
    * there is a "Getting Started" that takes me to the first `200` in no time
    * out-of-band documentation (if necessary at all) is easy to find and reference
    * out-of-band documentation clearly defines the API version it relates to
    * there is concise information on version history/new releases
    * license information can be retrieved automatically
    * terms of use are clearly defined, if possible in a standardized/machine-readable way
    * the API behaves "normal", in the sense that it sticks to standard(ized) behaviour of the web
    * all information is provided in English
* As a researcher, I expect that...
    * there are references to relevant publications, if possible annotated
    * there is a convenient way to reference (specific versions of) the source code
    * there is up-to-date information on the current status and the roadmap for development
* As a developer, I expect that...
    * the README is concise and helpful, but not overwhelming
    * there are tagged releases that allow understanding what a release is about immediately
    * there is up-to-date information on the current status and the roadmap for development
    * there is up-to-date contact information/clearly defined ways to reach the developers
    * there are contribution guidelines that include guidance on getting started with development
    * maintainers are responsive to requests
* As a PhD student, I expect that...
    * I can reuse most of the code that "powers" Designetz for demonstrating the validity and viability of my research
    * contributions by others do not bloat the service and make it a multi-purpose nightmare -- this is a _microservice_

## Requirements
Requirements marked in __bold__ are to be realized sooner rather than later; those in _italics_ entail more requirements that are not listed here.
* _The implementation MUST comply with the external stakeholder requirements_
    * _A containerized service instance MUST function correctly if started with `--readonly`_
    * _..._    
* _The implementation MUST comply with the internal (team-) requirements_
    * __The API MUST match its specification__
    * __The API MUST reuse schemata whenever possible__
    * __The API MUST use identifiers that cannot be guessed__
    * __The API MUST use identifiers that are guaranteed to be unique__
    * __The API MUST make use of [RFC 7807](https://tools.ietf.org/html/rfc7807) for all 4xx/5xx-responses__
        * The API MUST NOT disclose sensitive information through 4xx/5xx-responses -- compare section on [security considerations](https://tools.ietf.org/html/rfc7807#section-5)
    * __The microservice MUST validate all requests__
        * __The OAS MUST define all inputs via regular expressions__
        * __The OAS MUST provide at least one response schema__
        * The OAS MUST specify the media type of all responses using the "content-type"-header to avoid ambiguity present in version 2 of the OAS
        * The OAS SHOULD provide schemata of responses for all known errors
    * The microservice SHOULD support `x-request-id` headers and include them in all relevant logs
    * The microservice SHOULD NOT depend on outdated or insecure packages
    * A service instance MUST handle unavailable peer services gracefully
    * The Docker image MUST NOT contain any unnecessary files/binaries
    * _..._
* __The API MUST allow triggering a simulation__
* __The API MUST provide access to the results of a simulation__
* __The API MUST mitigate timeouts in a consistent manner__
* __The API MUST allow adding new model instances__
* The API MUST provide a representation of a model instance
* The API SHOULD provide a list of model instances that can be filtered
* The API SHOULD provide a list of model instances that can be sorted hierarchically
* The API MAY provide a list of executed experiments that can be filtered
* The API MAY provide a list of executed experiments that can be sorted hierarchically
* The API SHOULD allow deleting model instances
* The microservice MUST implement a specified strategy for forgetting old simulation results
* The microservice SHOULD implement a specified strategy against (D)DOS (aka "choking to death")
* The microservice SHOULD scale across threads, processors and machines dynamically iff necessary
* __The worker-process MUST simulate a given FMU 2.0 for co-simulation__
    * The worker-process MUST allow the specification of start time, stop time, and output interval
    * The worker-process MUST allow providing input to the simulation of an FMU
