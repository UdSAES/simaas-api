FROM node:10-alpine

LABEL me.msaas.vendor="UdS AES"
LABEL me.msaas.maintainer="moritz.stueber@aut.uni-saarland.de"
LABEL me.msaas.subject="SIMaaS Automated Tests"

# git is required by `npm install`
RUN set -ex && apk add --no-cache git

USER node
WORKDIR /home/node/

COPY --chown=node:node ./package.json /home/node/

RUN npm install --no-optional

COPY --chown=node:node oas/ /home/node/oas/
COPY --chown=node:node scripts/ /home/node/scripts/
COPY --chown=node:node test/ /home/node/test/
COPY --chown=node:node index.js /home/node/

ENTRYPOINT [ "/bin/sh" ]
