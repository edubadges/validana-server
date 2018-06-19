/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as http from "http";
import * as https from "https";
import * as FS from "fs";
import { Worker } from "cluster";
import { Handler } from "./handler";
import { Config } from "../config";
import { Log } from "../tools/log";
import { ActionHandler } from "../actionhandler";
import { Socket } from "net";

export class RestHandler extends Handler {
	private static headerOptions = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "POST, GET",
		"Access-Control-Allow-Headers": "origin, content-type, accept",
		"Access-Control-Max-Age": 86400
	};
	private readonly server: http.Server | https.Server;
	private isClosingServer: boolean = false;
	private restartTimeout: number = 5000;
	private permanentlyClosed: boolean = false;

	//The actually created action handlers and connections.
	private actionHandlers = new Map<Socket, ActionHandler>();

	/**
	 * Creates a new Handler.
	 * @param worker the worker that created this handler.
	 * @param port the port to use
	 */
	constructor(worker: Worker, port: number) {
		super(worker, port);

		//Setup the rest server
		if (!Config.get().VSERVER_TLS) {
			this.server = http.createServer();
		} else {
			this.server = https.createServer(this.loadCertificate()!);
			//If the file changes give it a second for both the key and the cert to change, then reload.
			FS.watchFile(Config.get().VSERVER_CERTPATH, (curr, prev) => {
				//Check if the file was modified and not just opened.
				if (curr.mtime !== prev.mtime) {
					setTimeout(() => {
						Log.info("Reloading certificate.");
						const newCertificate = this.loadCertificate();
						//Only reload if it succeeded loading the files.
						if (newCertificate !== undefined) {
							try {
								//Reloading certificates is not officially supported, but it works anyway.
								(this.server as any)._sharedCreds.context.setCert(newCertificate.cert);
								(this.server as any)._sharedCreds.context.setKey(newCertificate.key);
							} catch (error) {
								//Do not log possible certificate
								Log.error("Problem with reloading certificate.");
							}
						}
					}, 5000);
				}
			});
		}

		this.server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
			//Support pre-flight requests
			if (req.method === "OPTIONS") {
				res.writeHead(200, RestHandler.headerOptions);
				res.end();
				return;
			}

			if (req.url === undefined) {
				res.writeHead(400, RestHandler.headerOptions);
				res.end("Missing url.");
				return;
			}

			const urlParts = req.url.match(/[^\/]+/g);

			//See if it has an api version and request type
			if (urlParts === null || urlParts.length < 2) {
				res.writeHead(400, RestHandler.headerOptions);
				res.end("Missing api version or request type.");
				return;
			}

			//Get the api version and requestType
			const version = urlParts[urlParts.length - 2];
			if (!this.apiVersions.has(version)) {
				res.writeHead(501, RestHandler.headerOptions);
				res.end("Api version missing or not supported.");
				return;
			}
			const query = urlParts[urlParts.length - 1];
			const index = query.indexOf("?");
			const type = index === -1 ? query : query.slice(0, index);

			let data: any;
			if (req.method === "GET") {
				if (index !== -1) {
					try {
						data = JSON.parse(decodeURIComponent(query.slice(index + 1)));
					} catch (error) {
						res.writeHead(400, RestHandler.headerOptions);
						res.end("Invalid request json.");
						return;
					}
				}
			} else if (req.method === "POST") {
				//In case of a post request read the request body and try to parse it as json.
				let body = "";

				//Read part of the body
				req.on("data", (postData) => {
					body += postData.toString();
					if (body.length > 1000000) {
						res.writeHead(413, RestHandler.headerOptions);
						res.end("Payload too large.");
						return;
					}
				});

				//Finished reading body
				req.on("end", () => {
					if (body.length > 0) {
						try {
							data = JSON.parse(body);
						} catch (error) {
							res.writeHead(400, RestHandler.headerOptions);
							res.end("Invalid request json.");
							return;
						}
					}

					//Create an action handler and give it the data
					const AHPost = new (this.apiVersions.get(version)!)(this, undefined);
					this.actionHandlers.set(req.socket, AHPost);
					AHPost.receiveMessage(type, data)
						.then((responseData) => this.sendResponse(AHPost, res, responseData))
						.catch((error) => this.sendError(AHPost, res, error instanceof Error ? error.message : error));
				});

				//Will create response once we received all data.
				return;

			} else {
				res.writeHead(405, RestHandler.headerOptions);
				res.end("Invalid request method.");
				return;
			}

			//Create an action handler and give it the data
			const AHGet = new (this.apiVersions.get(version)!)(this, undefined);
			this.actionHandlers.set(req.socket, AHGet);
			AHGet.receiveMessage(type, data)
				.then((responseData) => this.sendResponse(AHGet, res, responseData))
				.catch((error) => this.sendError(AHGet, res, error instanceof Error ? error.message : error));
		});

		this.server.on("listening", () => this.restartTimeout = 5000);

		//Restart the server in a bit after an error.
		this.server.on("error", (error) => {
			Log.warn("Server error", error);
			if (!this.server.listening) {
				this.restartTimeout = Math.min(this.restartTimeout * 1.5, 300000);
				//We got an error while starting up
				this.shutdownServer(false).then(() => setTimeout(() => {
					if (!this.permanentlyClosed) {
						this.server.listen(Config.get().VSERVER_RESTPORT);
					}
				}, this.restartTimeout)).catch();
			} else {
				//We got an error while we are listening
				this.shutdownServer(false).then(() => setTimeout(() => {
					if (!this.permanentlyClosed) {
						this.server.listen(Config.get().VSERVER_RESTPORT);
					}
				}, this.restartTimeout)).catch();
			}
		});

		this.server.listen(this.port);
	}

	/** Shuts down the server. */
	public async shutdownServer(permanent: boolean): Promise<void> {
		this.permanentlyClosed = this.permanentlyClosed || permanent;

		if (this.isClosingServer) {
			if (this.permanentlyClosed) {
				return Promise.resolve();
			} else {
				return Promise.reject(new Error("Server already closing."));
			}
		} else {
			this.isClosingServer = true;
			for (const client of this.actionHandlers.keys()) {
				this.actionHandlers.get(client)!.terminate();
				client.destroy();
				this.actionHandlers.delete(client);
			}

			return new Promise<void>((resolve) => {
				this.server.close(() => {
					this.isClosingServer = false;
					resolve();
				});
			});
		}
	}

	protected sendResponse(ah: ActionHandler, responseObject: http.ServerResponse, data?: {}): void {
		if (this.server.listening && responseObject instanceof http.ServerResponse &&
			responseObject.connection !== null && !responseObject.connection.destroyed) {

			const dataString = JSON.stringify(data);
			Log.debug(`Send response: ${dataString}`);

			responseObject.writeHead(200, RestHandler.headerOptions);
			responseObject.end(dataString);
			ah.terminate();
		} else {
			Log.warn(`Cannot send message, server online: ${this.server.listening}`);
		}
	}

	public sendPush(_: ActionHandler, pushType: string, data: {}): void {
		//Do nothing, we don't support pushes. In fact actionHandlers should be destroyed before it ever gets to this...
		Log.warn(`Push type: ${pushType}, pushData: ${JSON.stringify(data)}`);
		Log.error("Tried to send push for a http handler.");
	}

	protected sendError(ah: ActionHandler | undefined, responseObject: http.ServerResponse, error: string): void {
		if (this.server.listening && responseObject instanceof http.ServerResponse &&
			responseObject.connection !== null && !responseObject.connection.destroyed) {
			Log.debug(`Send error: ${error}`);
			responseObject.writeHead(500, RestHandler.headerOptions);
			responseObject.end(error);
			if (ah !== undefined) {
				ah.terminate();
			}
		} else {
			Log.warn(`Cannot send message}, server online: ${this.server.listening}`);
		}
	}

	/**
	 * Load the certificate from the location found in the config file (if any).
	 * Returns undefined if it failed to load the certificate.
	 */
	private loadCertificate(): { key: Buffer, cert: Buffer } | undefined {
		try {
			return {
				key: FS.readFileSync(Config.get().VSERVER_KEYPATH),
				cert: FS.readFileSync(Config.get().VSERVER_CERTPATH)
			};
		} catch (error) {
			//Do not log error as it may contain the certificate key.
			Log.error(`Failed to load certificate at: key: ${Config.get().VSERVER_KEYPATH} and cert: ${Config.get().VSERVER_CERTPATH}.`);
			return undefined;
		}
	}
}