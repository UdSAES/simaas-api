# Start at current LTS release, but specify version explicitly
FROM node:14-alpine3.11 AS production

# Provide metadata according to namespace suggested by http://label-schema.org/
LABEL org.label-schema.schema-version="1.0.0-rc.1"
LABEL org.label-schema.name="simaas-api"
LABEL org.label-schema.description="Simulation as a Service Based on FMI 2.0 CS"
LABEL org.label-schema.vendor="UdS AES"
LABEL org.label-schema.vcs-url="https://github.com/UdSAES/simaas_api"


# Prepare directories and environment
ENV NODE_ENV=production
ENV WORKDIR=/home/node/app

USER node
RUN mkdir $WORKDIR
WORKDIR $WORKDIR

# Configure application according to directory structure created
ENV LISTEN_PORT=3000

EXPOSE $LISTEN_PORT

# Install app-level dependencies
COPY --chown=node:node package.json $WORKDIR
RUN npm install --production

# Install application code by copy-pasting the source to the image
# (subject to .dockerignore)
COPY --chown=node:node index.js $WORKDIR
COPY --chown=node:node lib $WORKDIR/lib/
COPY --chown=node:node oas $WORKDIR/oas/

# Store reference to commit in version control system in image
ARG VCS_REF
LABEL org.label-schema.vcs-ref=$VCS_REF

# Unless overridden, run this command upon instantiation
ENTRYPOINT [ "node", "index.js" ]
