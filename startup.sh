#!/bin/sh

# Heartbeat
echo "Entering startup.sh..."

# Start all sub-services
cd /home/node/queue; node index.js &
cd /home/node/worker; node index.js &
cd /home/node/api; node index.js
