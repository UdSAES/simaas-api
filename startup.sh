#!/bin/sh

# Start all sub-services
( cd /home/node/queue; LISTEN_PORT=$LISTEN_PORT_QUEUE node index.js ) &
( cd /home/node/worker; node index.js ) &
( cd /home/node/api; node index.js )
