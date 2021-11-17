# SPDX-FileCopyrightText: 2021 UdS AES <https://www.uni-saarland.de/lehrstuhl/frey.html>
# SPDX-License-Identifier: MIT


# Start at current LTS release, but specify version explicitly
FROM node:14-alpine3.11 AS production

# Provide metadata according to namespace suggested by http://label-schema.org/
LABEL org.label-schema.schema-version="1.0.0-rc.1"
LABEL org.label-schema.name="simaas-api"
LABEL org.label-schema.description="Simulation as a Service Based on FMI 2.0 CS"
LABEL org.label-schema.vendor="UdS AES"
LABEL org.label-schema.vcs-url="https://github.com/UdSAES/simaas-api"


# Prepare directories and environment
ENV NODE_ENV=production
ENV WORKDIR=/home/node/app

ENV FS_PATH=/srv
RUN chown node:node $FS_PATH

USER node
RUN mkdir $WORKDIR
WORKDIR $WORKDIR

# Configure application according to directory structure created
ENV SIMAAS_TMPFS_PATH=/tmp
ENV SIMAAS_FS_PATH=$FS_PATH
ENV UI_STATIC_FILES_PATH=./source/redoc.html
ENV UI_URL_PATH=/ui

ENV SIMAAS_LISTEN_PORT=3000
EXPOSE $SIMAAS_LISTEN_PORT

# Install app-level dependencies
COPY --chown=node:node package.json $WORKDIR
RUN npm install --production

# Patch `amqplib` to ensure that model descriptions can be enqueued
COPY --chown=node:node scripts/set_buffer_size_amqplib.js $WORKDIR
ENV SIMAAS_SCRATCH_BUFFER_SIZE=262144
RUN node set_buffer_size_amqplib.js

# Install application code by copy-pasting the source to the image
# (subject to .dockerignore)
COPY --chown=node:node index.js $WORKDIR
COPY --chown=node:node lib $WORKDIR/source/
COPY --chown=node:node oas $WORKDIR/oas/

# Store reference to commit in version control system in image
ARG VCS_REF
LABEL org.label-schema.vcs-ref=$VCS_REF

# Unless overridden, run this command upon instantiation
ENTRYPOINT [ "node", "index.js" ]
