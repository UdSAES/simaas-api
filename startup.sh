#!/bin/sh

# Heartbeat
echo "Alive!"

# Start component for managing work items
cd queue; node index.js &
cd ../worker; node index.js

# Start proxy that implements the API of this application
