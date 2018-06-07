#!/bin/sh

# Start all sub-services
( cd /home/node/queue; LISTEN_PORT=$LISTEN_PORT_QUEUE node index.js ) &
( cd /home/node/worker; unset HTTP_PROXY; unset HTTPS_PROXY; unset FTP_PROXY; unset NO_PROXY; unset http_proxy; unset https_proxy; unset ftp_proxy; unset no_proxy; node index.js ) &
( cd /home/node/api; node index.js )
