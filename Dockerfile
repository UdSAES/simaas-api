FROM node:10-alpine

LABEL me.msaas.vendor="UdS AES"
LABEL me.msaas.maintainer="moritz.stueber@aut.uni-saarland.de"
LABEL me.msaas.subject="Simulation as a Service"

RUN set -ex && apk add --no-cache gcc libc6-compat python3 py3-numpy py3-lxml
RUN set -ex && python3 -m pip install pipenv --upgrade

ENV PYTHON=/usr/bin/python3
ENV NODE_ENV=production

USER node

# Configure queue ##############################################################
ENV LISTEN_PORT_QUEUE 12345

RUN mkdir /home/node/queue
WORKDIR /home/node/queue

COPY --chown=node:node ./udsaes_async_queue/package.json /home/node/queue

RUN npm install --production

COPY --chown=node:node ./udsaes_async_queue/ /home/node/queue/

# Configure workers ############################################################
ENV QUEUE_ORIGIN http://127.0.0.1:${LISTEN_PORT_QUEUE}
ENV MODEL_BASE_PATH /mnt/FMUs
ENV LC_ALL en_GB.utf8
ENV LANG en_GB.utf8

RUN mkdir /home/node/worker
WORKDIR /home/node/worker

COPY --chown=node:node ./simaas_worker/Pipfile /home/node/worker
COPY --chown=node:node ./simaas_worker/Pipfile.lock /home/node/worker

USER root
RUN mkdir /mnt/FMUs
RUN chown node:node /mnt/FMUs
RUN set -ex && pipenv install --deploy --system --ignore-pipfile
USER node

COPY --chown=node:node ./simaas_worker/package.json /home/node/worker

RUN npm install --production

COPY --chown=node:node ./simaas_worker/ /home/node/worker/

# Configure API ################################################################
ENV QUEUE_ORIGIN http://127.0.0.1:${LISTEN_PORT_QUEUE}
ENV LISTEN_PORT 3000

RUN mkdir /home/node/api
RUN mkdir /home/node/api/oas
WORKDIR /home/node/api

COPY --chown=node:node ./package.json /home/node/api

RUN npm install --production

COPY --chown=node:node ./oas/ /home/node/api/oas/
COPY --chown=node:node ./index.js /home/node/api

# Start application ############################################################
COPY --chown=node:node ./startup.sh /home/node/
WORKDIR /home/node

EXPOSE 3000

ENTRYPOINT [ "/home/node/startup.sh" ]
