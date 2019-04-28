FROM registry.leela.msaas.me:9097/simaas_api_generic:latest

LABEL me.msaas.subject="SIMaaS Automated Tests"

# git is required by `npm install`
USER root
RUN set -ex && apk add --no-cache git

WORKDIR /home/node/api
RUN npm install --only=dev --no-optional

USER node
COPY --chown=node:node oas/ /home/node/api/oas/
COPY --chown=node:node scripts/ /home/node/api/scripts/
COPY --chown=node:node test/ /home/node/api/test/


ENTRYPOINT [ "/bin/sh" ]
