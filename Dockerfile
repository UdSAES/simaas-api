FROM node:9.6.1-alpine

MAINTAINER Moritz Stüber

RUN set -ex && apk add --no-cache gcc libc6-compat python3 py3-numpy py3-lxml
RUN set -ex && python3 -m pip install pipenv --upgrade

ENV PYTHON=/usr/bin/python3

USER node

# Configure queue ##############################################################
ENV LISTEN_PORT=3000
ENV URL_HOST=http://127.0.0.1:3000

RUN mkdir /home/node/queue
WORKDIR /home/node/queue

COPY --chown=node:node ./asynchronous_api_implementation/package.json /home/node/queue

RUN npm install

COPY --chown=node:node ./asynchronous_api_implementation/ /home/node/queue/

# Configure workers ############################################################
ENV URL_QUEUE=http://127.0.0.1:3000

RUN mkdir /home/node/worker
WORKDIR /home/node/worker

COPY --chown=node:node ./simaas_worker/Pipfile /home/node/worker
COPY --chown=node:node ./simaas_worker/Pipfile.lock /home/node/worker

USER root
RUN set -ex && pipenv install --deploy --system --ignore-pipfile
USER node

COPY --chown=node:node ./simaas_worker/package.json /home/node/worker

RUN npm install

COPY --chown=node:node ./simaas_worker/ /home/node/worker/

# Configure API ################################################################

# Start application ############################################################
COPY --chown=node:node ./startup.sh /home/node/
WORKDIR /home/node

EXPOSE 3000

CMD /home/node/startup.sh
