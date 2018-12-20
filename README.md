Validana Server for Educhain
============================
Validana Server for Educhain can be run in the same way as the [Validana Server](https://github.com/Coinversable/validana-server). The only difference is that it has 2 additional config keys, namely VSERVER_ADDR, which should be the address of the processor, and VSERVER_NAME, which should be name given to the processor as displayed by the front end (by default "Surf"). A Dockerfile is available with most of the configuration for Validana Server for Educhain already filled in (though commented out).

Setup Development environment
-----------------------------
1. Install Node.js (https://nodejs.org/en/download/)
2. Install yarn (https://yarnpkg.com/en/docs/install)
3. Run `yarn global add typescript tslint`

Setup Validana Server for Educhain
----------------------------------
1. Make sure the development environment is setup.
2. Clone the project with git.
3. Navigate to project root.
4. Run `yarn install`

Build Validana Server for Educhain
----------------------------------
1. Make sure the project is setup.
2. Navigate to project root.
3. Run `yarn build`

Start Validana Server for Educhain
----------------------------------
1. Make sure the project is build.
2. Navigate to project root.
3. Run `yarn start path/to/config.json` (Alternately use environment variables instead of a config file.)