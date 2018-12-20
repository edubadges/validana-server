ARG NODEVERSION=10
FROM node:${NODEVERSION}

# Clone the projects into the docker container and compile it
ENV NODE_ENV=production
RUN yarn global add typescript
COPY . /usr/node
RUN yarn --cwd /usr/node install
RUN tsc -p /usr/node/tsconfig.json

# Add environment variables
#ENV VSERVER_API={\"v1\":\"/usr/node/dist/surfactionhandlerV1.js\"}
#ENV VSERVER_RESTPORT=8080
#ENV VSERVER_WSPORT=8081
#ENV VSERVER_TLS=false
#ENV VSERVER_KEYPATH=
#ENV VSERVER_CERTPATH=
#ENV VSERVER_DBPASSWORD=
#ENV VSERVER_DBUSER=backend
#ENV VSERVER_DBNAME=blockchain
#ENV VSERVER_DBHOST=localhost
#ENV VSERVER_WORKERS=-1
#ENV VSERVER_LOGLEVEL=0
#ENV VSERVER_DBPORT=5432
#ENV VSERVER_MAXMEMORY=1024
#ENV VSERVER_UPDATEINTERVAL=3
#ENV VSERVER_TIMEOUT=60
#ENV VSERVER_SENTRYURL=

#ENV VSERVER_ADDR=
#ENV VSERVER_NAME=Surf

#Add user and entry point
USER node
ENTRYPOINT node /usr/node/dist/index.js