# Simulation as a Service Using a Task Queue, Workers and FMPy
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

This repository contains an implementation of SIMaaS that uses dedicated worker-processes to execute simulation jobs stored in a tasks queue. For simulation, the worker-processes use [FMPy](https://github.com/CATIA-Systems/FMPy) instead of [PyFMI](https://github.com/modelon/PyFMI) to execute FMUs due to the much less complicated dependencies of the former.

See [`./docs/requirements.md`](./docs/requirements.md) for the full list of requirements that this microservice attempts to implement and [`./docs/versions.md`](./docs/versions.md) for details on the version history, including release notes.
