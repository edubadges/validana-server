/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Cluster from "cluster";
import * as FS from "fs";
import * as Path from "path";
import { Crypto } from "./tools/crypto";
import { Log } from "./tools/log";

/** The config for the backend. Using all capitalized names because this is the standard for environment variables. */
export interface StringConfig {
	VSERVER_DBUSER: string; //Database user
	VSERVER_DBPASSWORD: string; //Database password
	VSERVER_DBNAME: string; //Database name
	VSERVER_DBHOST: string; //Database host
	VSERVER_SENTRYURL: string; //The sentry url for error reporting (optional)
	VSERVER_API: string; //All api versions that this backend supports
	VSERVER_KEYPATH: string; //Certificate (in case you use no reverse proxy)
	VSERVER_CERTPATH: string; //Certificate (in case you use no reverse proxy)
}
export interface NumberConfig {
	VSERVER_LOGLEVEL: number; //The log level we use.
	VSERVER_DBPORT: number; //Database port
	VSERVER_MAXMEMORY: number; //How much memory is the handler allowed to use before we restart it.
	VSERVER_UPDATEINTERVAL: number; //How often it checks for new transactions (in seconds)
	VSERVER_RESTPORT: number; //Port to listen to connections to for http connections.
	VSERVER_WSPORT: number; //Ports to listen to connections to for ws connecions.
	VSERVER_TIMEOUT: number; //How long it waits between keep alive checks (in seconds)
	VSERVER_WORKERS: number; //How many workers do we want to have (0 or lower is all processing cores minus the number, 1+ is that many workers)
}
export interface BooleanConfig {
	VSERVER_TLS: boolean; //Whether to use tls or not
}

/** A singleton config file. The first time Config.get() is called it will load the config and validate all values. */
export class Config {
	private static config: any = undefined;
	private static validators = new Array<() => void>();
	//The default values
	private static readonly stringConfig = {
		VSERVER_DBUSER: "backend",
		VSERVER_DBNAME: "blockchain",
		VSERVER_DBHOST: "localhost",
		VSERVER_DBPASSWORD: "",
		VSERVER_SENTRYURL: "",
		VSERVER_API: "",
		VSERVER_KEYPATH: "",
		VSERVER_CERTPATH: ""
	};
	private static readonly numberConfig: NumberConfig = {
		VSERVER_LOGLEVEL: 0,
		VSERVER_DBPORT: 5432,
		VSERVER_RESTPORT: 0,
		VSERVER_WSPORT: 0,
		VSERVER_TIMEOUT: 60,
		VSERVER_UPDATEINTERVAL: 3,
		VSERVER_MAXMEMORY: 256,
		VSERVER_WORKERS: -1
	};
	private static readonly booleanConfig: BooleanConfig = {
		VSERVER_TLS: true
	};

	public static get<T = StringConfig & NumberConfig & BooleanConfig>(): Readonly<T> {
		if (Config.config === undefined) {
			Config.loadEnv();
			if (Cluster.isMaster) {
				Config.loadFile();
				Config.validate();
			}

			Config.config = Object.assign(Config.stringConfig, Config.numberConfig, Config.booleanConfig);
		}
		return Config.config;
	}

	/**
	 * Add a new variable to the config, for which it will check environment variables and config file.
	 * @param name The name of the variable
	 * @param defaultValue Default value for the variable
	 * @param validator The validator. It should throw an error if it is not valid.
	 */
	public static addStringConfig<T extends {}>(name: string, defaultValue?: string, validator?: (input: string | undefined, config: Config & T) => void): Config & T {
		if ((Config.stringConfig as any)[name] !== undefined) {
			Log.warn(`Overwriting config: ${name}`);
		}
		(Config.stringConfig as any)[name] = defaultValue;
		if (validator !== undefined) {
			Config.validators.push(() => validator((Config.stringConfig as any)[name], Config as typeof Config & T));
		}
		return Config as typeof Config & T;
	}

	/**
	 * Add a new variable to the config, for which it will check environment variables and config file.
	 * @param name The name of the variable
	 * @param defaultValue Default value for the variable
	 * @param validator The validator. It should throw an error if it is not valid.
	 */
	public static addNumberConfig<T extends {}>(name: string, defaultValue?: number, validator?: (input: number | undefined, config: Config & T) => void): Config & T {
		if ((Config.numberConfig as any)[name] !== undefined) {
			Log.warn(`Overwriting config: ${name}`);
		}
		(Config.numberConfig as any)[name] = defaultValue;
		if (validator !== undefined) {
			Config.validators.push(() => validator((Config.numberConfig as any)[name], Config as typeof Config & T));
		}
		return Config as typeof Config & T;
	}

	/**
	 * Add a new variable to the config, for which it will check environment variables and config file.
	 * @param name The name of the variable
	 * @param defaultValue Default value for the variable
	 * @param validator The validator. It should throw an error if it is not valid.
	 */
	public static addBoolConfig<T extends {}>(name: string, defaultValue?: boolean, validator?: (input: boolean, config: Config & T) => void): Config {
		if ((Config.booleanConfig as any)[name] !== undefined) {
			Log.warn(`Overwriting config: ${name}`);
		}
		(Config.booleanConfig as any)[name] = defaultValue;
		if (validator !== undefined) {
			Config.validators.push(() => validator((Config.booleanConfig as any)[name], Config as typeof Config & T));
		}
		return Config as typeof Config & T;
	}

	/** Load all keys from the environment variables. */
	private static loadEnv(): void {
		//Load all keys from environmental variables
		for (const key of Object.keys(Config.stringConfig)) {
			const processKey = process.env[key];
			if (processKey !== undefined) {
				Config.stringConfig[key as keyof StringConfig] = processKey;
			}
		}
		for (const key of Object.keys(Config.numberConfig)) {
			const processKey = process.env[key];
			if (processKey !== undefined) {
				const envValue = Number.parseInt(processKey);
				if (!Number.isSafeInteger(envValue)) {
					throw new Error(`Invalid value for environment variable: ${key}, expected a number.`);
				} else {
					Config.numberConfig[key as keyof NumberConfig] = envValue;
				}
			}
		}
		for (const key of Object.keys(Config.booleanConfig)) {
			const processKey = process.env[key];
			if (processKey !== undefined) {
				if (processKey !== "true" && processKey !== "false") {
					throw new Error(`Invalid value: ${processKey} for environment variable: ${key}, expected 'true' or 'false'.`);
				} else {
					Config.booleanConfig[key as keyof BooleanConfig] = processKey === "true";
				}
			}
		}
	}

	/** Load all keys from the config file. */
	private static loadFile(): void {
		//arg 0 is node.exe, arg 1 is this script.js, arg2+ are the passed arguments
		if (process.argv.length >= 3) {
			//Determine where the config file should be and if it exists.
			const configPath = Path.resolve(process.argv[process.argv.length - 1]);
			if (!FS.existsSync(configPath)) {
				throw new Error(`Unable to find file: ${configPath}.`);
			}
			//Load config file.
			let configFile: any;
			try {
				configFile = JSON.parse(Crypto.binaryToUtf8(FS.readFileSync(configPath)));
			} catch (error) {
				throw new Error(`Unable to load config file: ${configPath}: ${(error as Error).stack}.`);
			}

			//Load all values from the config file
			for (const key of Object.keys(configFile)) {
				if (Config.stringConfig.hasOwnProperty(key)) {
					if (typeof configFile[key] !== "string") {
						throw new Error(`Invalid type in config file for key: ${key}, expected a string.`);
					} else {
						Config.stringConfig[key as keyof StringConfig] = configFile[key].toString();
					}
				} else if (Config.numberConfig.hasOwnProperty(key)) {
					if (!Number.isSafeInteger(configFile[key])) {
						throw new Error(`Invalid type in config file for key: ${key}, expected an integer.`);
					} else {
						Config.numberConfig[key as keyof NumberConfig] = configFile[key];
					}
				} else if (Config.booleanConfig.hasOwnProperty(key)) {
					if (typeof configFile[key] !== "boolean") {
						throw new Error(`Invalid type in config file for key: ${key}, expected a boolean.`);
					} else {
						Config.booleanConfig[key as keyof BooleanConfig] = configFile[key];
					}
				} else {
					Log.warn(`Unknown config file key: ${key}`);
				}
			}
		}
	}

	/** Validate if all values are correct. */
	public static validate(): void {
		//Check if all numbers have a valid value (NaN always results to false comparisons) and are in range:
		if (Config.numberConfig.VSERVER_DBPORT <= 0 || Config.numberConfig.VSERVER_DBPORT > 65535) {
			throw new Error(`Invalid db port: ${Config.numberConfig.VSERVER_DBPORT}, should be 1-65535.`);
		}
		if (Config.numberConfig.VSERVER_RESTPORT < 0 || Config.numberConfig.VSERVER_RESTPORT > 65535) {
			throw new Error(`Invalid http port: ${Config.numberConfig.VSERVER_RESTPORT}, should be 0-65535.`);
		}
		if (Config.numberConfig.VSERVER_WSPORT < 0 || Config.numberConfig.VSERVER_WSPORT > 65535) {
			throw new Error(`Invalid ws port: ${Config.numberConfig.VSERVER_WSPORT}, should be 0-65535.`);
		}
		//Eighter they use the same port or they are both empty.
		if (Config.numberConfig.VSERVER_RESTPORT === Config.numberConfig.VSERVER_WSPORT) {
			if (Config.numberConfig.VSERVER_RESTPORT !== 0) {
				throw new Error(`Invalid ws and rest ports, they may not be the same.`);
			} else {
				throw new Error(`Invalid ws and rest ports, at least one should be defined.`);
			}
		}

		if (Config.numberConfig.VSERVER_LOGLEVEL < Log.Debug || Config.numberConfig.VSERVER_LOGLEVEL > Log.None) {
			throw new Error(`Invalid log level: ${Config.numberConfig.VSERVER_LOGLEVEL}, should be 0-5.`);
		}
		if (Config.numberConfig.VSERVER_TIMEOUT < 5) {
			throw new Error(`Invalid block interval: ${Config.numberConfig.VSERVER_TIMEOUT}, should be at least 5 seconds.`);
		}
		if (Config.numberConfig.VSERVER_UPDATEINTERVAL <= 0) {
			throw new Error(`Invalid update interval: ${Config.numberConfig.VSERVER_UPDATEINTERVAL}, should be at least 1 second.`);
		}
		if (Config.numberConfig.VSERVER_MAXMEMORY < 50) {
			throw new Error(`Invalid max memory: ${Config.numberConfig.VSERVER_MAXMEMORY}, should be at least 50 MB.`);
		}
		if (Config.booleanConfig.VSERVER_TLS && (Config.stringConfig.VSERVER_KEYPATH === "" || Config.stringConfig.VSERVER_CERTPATH === "")) {
			throw new Error("Invalid keypath or certpath, using tls but one of them is undefined.");
		}
		//If we use tls check if we can load key and certificate
		if (Config.booleanConfig.VSERVER_TLS) {
			Config.stringConfig.VSERVER_KEYPATH = Path.resolve(Config.stringConfig.VSERVER_KEYPATH);
			Config.stringConfig.VSERVER_CERTPATH = Path.resolve(Config.stringConfig.VSERVER_CERTPATH);
			if (!FS.existsSync(Config.stringConfig.VSERVER_CERTPATH)) {
				throw new Error(`Invalid keypath: Unable to find file ${Config.stringConfig.VSERVER_KEYPATH}`);
			}
			if (!FS.existsSync(Config.stringConfig.VSERVER_CERTPATH)) {
				throw new Error(`Invalid keypath: Unable to find file ${Config.stringConfig.VSERVER_CERTPATH}`);
			}
		}
		//Check if the provided api's are valid
		let hasApi = false;
		try {
			const apis = JSON.parse(Config.stringConfig.VSERVER_API);
			for (const apiName of Object.keys(apis)) {
				hasApi = true;
				try {
					if (typeof (require(Path.resolve(apis[apiName])).default) !== "function") {
						throw new Error(`The Api ${apis[apiName]} as found in: ${Config.stringConfig.VSERVER_API}, must contain a default exported class extending actionhandler.`);
					}
				} catch (error) {
					throw new Error(`Could not find file ${Path.resolve(apis[apiName])} as found in: ${Config.stringConfig.VSERVER_API}: ${(error as Error).message}: ${(error as Error).stack}`);
				}
			}
		} catch (error) {
			throw new Error(`Invalid api: ${Config.stringConfig.VSERVER_API}: ${(error as Error).message}: ${(error as Error).stack}`);
		}
		if (!hasApi) {
			throw new Error(`No provided api: ${Config.stringConfig.VSERVER_API}.`);
		}
		//The extended config file options.
		for (const validator of Config.validators) {
			validator();
		}
	}
}