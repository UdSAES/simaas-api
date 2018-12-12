# Simulation as a Service Using a Task Queue, Workers and FMPy
This repository contains an implementation of SIMaaS that uses dedicated worker-processes to execute FMUs stored in a tasks queue. For simulation, the worker-processes use [FMPy](https://github.com/CATIA-Systems/FMPy) instead of [PyFMI](https://github.com/modelon/PyFMI) due to the much less complicated dependencies of the former. See [`./docs/requirements.md`](./docs/requirements.md) for the full list of requirements that this microservice attempts to implement.

[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Installation
The service can be run as both a group of native Node.js-processes or using Docker.

### Configuration
The microservice can be configured using the environment variables described below. Environment variables that are already set when deploying a service instance using Docker are marked by an asterisk\*; variables that MUST be set when running an instance using `node index.js` are marked in __bold__.

ENVVAR                          | Description                                         | Default Value
---                             | ---                                                 | ---     
:wavy_dash: API                 |                                                     |
`QUEUE_ORIGIN`\*                | __The origin of the task queue__                    |
`LISTEN_PORT`\*                 | __The port on which the service listens__           |
`ALIVE_EVENT_WAIT_TIME`         | The cycle time of the heartbeat (API)               | `3600 s`     
`UI_STATIC_FILES_PATH`          | Path in file system to custom static website/UI     | `''`
`UI_URL_PATH`                   | Path (in URL) under which static content is exposed | `''`
:wavy_dash: Queue               |                                                     |
`LISTEN_PORT`\*                 | __The port on which the queue listens__             |
`ALIVE_EVENT_WAIT_TIME`         | The cycle time of the heartbeat (queue)             | `3600 s`
:wavy_dash: Worker              |                                                     |
`QUEUE_ORIGIN`\*                | __The origin of the task queue__                    |
`MODEL_BASE_PATH`\*             | __The path to the model instances__ (stored as FMU) |
`WAIT_TIME`\*                   | Cycle time for polling the existence of new jobs    | `50 ms`
`ALIVE_EVENT_WAIT_TIME`         | The cycle time of the heartbeat (worker)            | `3600 s`

### Using Docker
```bash
# Create flat version of OAS to ensure that container can run without web access
npm run api-resolve

# Build image
docker build -t simaas_api .

# Run using default configuration (possibly mount local FMUs for testing)
docker run --name simaas_api -p 3000:3000 -d simaas_api:latest
```

### Using Node.js
Internally, the microservice is composed of three different processes: one for the API, one for the queue, and one for the worker. Unfortunately, this makes running the application as a group of native Node.js-processes a bit complicated because it has to be ensured that `SIGTERM`/`SIGINT` are properly propagated -- solution shown below (discussion out of scope).

Also note that the dependency on FMPy cannot be resolved unless you first spawn a pipenv-shell in which the dependencies specified in [`./simaas_worker/Pipfile`](./simaas_worker/Pipfile) are satisfied and then execute the script below from within this shell!

```bash
#!/bin/sh

# Configure script
DIR_BASE=...

# Set environment variables
export QUEUE_ORIGIN=...
export LISTEN_PORT_API=...
export LISTEN_PORT_QUEUE=...
export MODEL_BASE_PATH=...
...

# Set up functions for properly forwarding SIGTERM
# https://unix.stackexchange.com/a/444676
prep_term()
{
    unset term_child_pid
    unset term_kill_needed
    trap 'handle_term' TERM INT
}

handle_term()
{
    if [ "${term_child_pid}" ]; then
        kill -TERM "${term_child_pid}" 2>/dev/null
    else
        term_kill_needed="yes"
    fi
}

wait_term()
{
    term_child_pid=$!
    if [ "${term_kill_needed}" ]; then
        kill -TERM "${term_child_pid}" 2>/dev/null
    fi
    wait ${term_child_pid} 2>/dev/null
    trap - TERM INT
    wait ${term_child_pid} 2>/dev/null
}

# Start all sub-services, enclosed by functions that ensure SIGTERM is caught
prep_term

(( cd $DIR_BASE/udsaes_async_queue; LISTEN_PORT=$LISTEN_PORT_QUEUE node index.js ) &
( cd $DIR_BASE/simaas_worker; node index.js ) &
( cd $DIR_BASE; LISTEN_PORT=$LISTEN_PORT_API node index.js )) &

wait_term
```

## Usage
The SIMaaS-microservice exposes a REST-based HTTP API, which is formally described according to the [OpenAPI Specification (version 2.0)](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md#schema).

Consult the description of the API, located at [`./oas/simaas_oas2.json`](./oas/simaas_oas2.json), for details of how to interact with a service instance. A website visualizing the specification using [ReDoc](https://github.com/Rebilly/ReDoc) can be started locally by executing `npm run api-serve` from a shell (iff development dependencies are installed, see section [Development](#development)). Alternatively, view it online in the [Swagger Editor](https://editor.swagger.io/#?url=https://raw.githubusercontent.com/UdSAES/simaas_api/master/oas/simaas_oas2.json) (link broken unless repository is made public as `?url=..`-parameter cannot be resolved).

## Development
For the developer's convenience, a series of [npm package scripts](https://docs.npmjs.com/cli/run-script) are defined for facilitating development. Ensure that the development dependencies are installed and then invoke the scripts using `npm run <cmd> --silent`. The commands marked with an asterisk\* require `SIMAAS_INSTANCE` to be set to the full URL of a running service instance!

Command       | Description
---           | ---
`lint`        | Lint source code to enforce [JavaScript Standard Style](https://standardjs.com/)
`lint-fix`    | Fix code style issues that can be resolved automatically
`api-serve`   | Locally serve an interactive visualization of the OAS using  [ReDoc](https://github.com/Rebilly/ReDoc)
`api-resolve` | Dereference all `$ref` instructions in the OAS (version 2 only, resulting file excluded from git!)
`api-2oas3`   | Convert the OAS from version 2 to version 3 (resolves `$ref`, resulting file excluded from git!)
`api-lint`    | Lint generated OAS3 using [Speccy](https://speccy.io/) and a [custom ruleset](https://speccy.io/rules/2-custom-rulesets)
`dredd`\*     | Verify implementation against OAS using [Dredd](https://github.com/apiaryio/dredd)
`test-all`\*  | Run `lint`, `api-lint` and `dredd`; fail if any of them fails
