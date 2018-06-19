/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as WebSocket from "ws";
import * as http from "http";
import * as https from "https";
import * as FS from "fs";
import { Worker } from "cluster";
import { ActionHandler } from "../actionhandler";
import { Log } from "../tools/log";
import { Config } from "../config";
import { Handler } from "./handler";

/** Simple extension to see if the WebSocket is still connected. */
class ExtendedWebSocket extends WebSocket {
	public isAlive: boolean = false;
}

/** Expected request message format. */
interface RequestMessage {
	type: string;
	id?: string;
	data?: {};
}

/** Interface for responding. */
interface ResponseOrPushMessage {
	error?: string;
	data?: {};
	id?: string;
	pushType?: string;
}

/**
 * The handler is responsible for receiving websocket connections
 * as well as receiving messages and sending messages.
 */
export class WebsocketHandler extends Handler {
	private server: WebSocket.Server | undefined;
	private restServer: http.Server | https.Server | undefined;
	private serverOptions: WebSocket.ServerOptions | undefined;
	private isClosingServer: boolean = false;
	private serverListening: boolean = false;
	private permanentlyClosed: boolean = false;
	private watchingCert: boolean = false;
	private restartTimeout: number = 5000;
	private timeout: number | undefined;

	//The actually created action handlers.
	private actionHandlers = new Map<WebSocket, ActionHandler>();

	/**
	 * Creates a new Handler.
	 * @param worker the worker that created this handler.
	 * @param port the port to use
	 */
	constructor(worker: Worker, port: number) {
		super(worker, port);
		this.createServer();
	}

	private createServer(): void {
		if (this.permanentlyClosed) {
			return;
		}

		//Setup the rest server
		if (!Config.get().VSERVER_TLS) {
			this.restServer = http.createServer();
		} else {
			this.restServer = https.createServer(this.loadCertificate()!);
			//If the file changes give it a second for both the key and the cert to change, then reload.
			if (!this.watchingCert) {
				this.watchingCert = true;
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
									(this.restServer as any)._sharedCreds.context.setCert(newCertificate.cert);
									(this.restServer as any)._sharedCreds.context.setKey(newCertificate.key);
								} catch (error) {
									//Do not log possible certificate
									Log.error("Problem with reloading certificate.");
								}
							}
						}, 5000);
					}
				});
			}
		}

		this.timeout = Config.get().VSERVER_TIMEOUT;
		this.serverOptions = {
			maxPayload: 1000000,
			server: this.restServer
		};

		//Start the websocket server.
		this.server = new WebSocket.Server(this.serverOptions);
		this.restServer.listen(this.port);

		this.server.on("listening", () => { this.serverListening = true; this.restartTimeout = 5000; });

		//We recreate the server after an error as websocket server has no option to just restart listening again.
		this.server.on("error", (error) => {
			Log.warn("Server error", error);
			if (!this.serverListening) {
				this.restartTimeout = Math.min(this.restartTimeout * 1.5, 300000);
				//We got an error while starting up
				this.shutdownServer(false).then(() => setTimeout(() => this.createServer(), this.restartTimeout)).catch();
			} else {
				//We got an error while we are listening
				this.shutdownServer(false).then(() => setTimeout(() => this.createServer(), 5000)).catch();
			}
		});

		//Every second check for 1/timeout number of clients if they are still alive, for an average of once per timeout for each client.
		let currentTimer = this.timeout!;
		let clientsToCheck: WebSocket[] = [];
		const interval = setInterval(() => {
			if (this.serverListening) {
				currentTimer--;
				//We have fisnished for all client, get all clients again
				if (currentTimer === 0) {
					clientsToCheck = Array.from(this.server!.clients) as WebSocket[];
					currentTimer = this.timeout!;
				}
				//For all clients that we still need to check check 1/timeout part of them
				const clientsToCheckThisTime = Math.ceil(1 / currentTimer * clientsToCheck.length);
				for (let i = 0; i < clientsToCheckThisTime; i++) {
					//Remove them from the list of clients to check.
					const client = clientsToCheck.pop()!;
					//If it is still open (e.g. not already terminated since indexing and arriving here):
					if (client.readyState === WebSocket.OPEN) {
						if (!(client as ExtendedWebSocket).isAlive) {
							//If the client is no longer responding to 'keep alive' message.
							client.terminate();
							continue;
						}
						(client as ExtendedWebSocket).isAlive = false;
						client.ping();
					}
				}
			} else {
				//Server is down, clear interval, it will be started again when server starts again.
				clearInterval(interval);
			}
		}, 1000);

		//What if someone connects?
		this.server.on("connection", (client, request) => {
			Log.debug(`Worker ${this.worker.id} received an incomming connection.`);

			//Check if the client connects in a valid way.
			if (request.url === undefined) {
				client.close(4100, "Invalid way of connecting.");
				client.terminate();
				return;
			}

			//Check if the client tries to connect to a valid api version.
			const urlParts = request.url.match(/[^\/]+/g);
			if (urlParts === null || urlParts.length < 1 || !this.apiVersions.has(urlParts[urlParts.length - 1])) {
				client.close(4100, "Version of the api is not supported.");
				client.terminate();
				return;
			}

			const AH = new (this.apiVersions.get(urlParts[urlParts.length - 1])!)(this, client);
			this.actionHandlers.set(client, AH);
			(client as ExtendedWebSocket).isAlive = true;

			//There is an error with the client connection.
			client.on("error", (error) => {
				//It should send a close as well, but just in case.
				this.terminateClient(client, "Web socket error", error);
			});

			//The connection is closed by the client.
			client.on("close", () => {
				Log.debug(`A connection to worker ${this.worker.id} closed.`);
				this.terminateClient(client);
			});

			//If we receive a reply to our 'keep alive' message mark client as still alive.
			client.on("pong", () => {
				(client as ExtendedWebSocket).isAlive = true;
			});

			//The client send a message the new Handler will change the websocket to the right handler.
			client.on("message", (messageData: WebSocket.Data) => {
				Log.debug(`Received: ${messageData}`);

				//If the message is not valid json.
				let message: RequestMessage;
				try {
					message = JSON.parse(messageData.toString());
				} catch (error) {
					return this.sendError(AH, "", "Invalid JSON");
				}

				//If the message is missing important fields
				if (typeof message.id !== "string") {
					return this.sendError(AH, "", "Request is missing or has an invalid an ID field");
				}
				if (typeof message.type !== "string") {
					return this.sendError(AH, message.id, "Request is missing or has an invalid request type");
				}

				AH.receiveMessage(message.type, message.data)
					.then((responseData) => this.sendResponse(AH, message.id!, responseData))
					.catch((error) => this.sendError(AH, message.id!, error instanceof Error ? error.message : error));
			});
		});
	}

	protected sendResponse(ah: ActionHandler, responseObject: string, data?: {}): void {
		const client: WebSocket = ah.client;
		if (client.readyState === client.OPEN && this.serverListening && typeof responseObject === "string") {
			const response: ResponseOrPushMessage = {
				id: responseObject
			};
			if (data !== undefined) {
				response.data = data;
			}
			const responseString = JSON.stringify(response);
			Log.debug(`Send response: ${responseString}`);
			client.send(responseString, (error: Error | undefined) => {
				if (error !== undefined) {
					this.terminateClient(client, "Failed to send message", error);
				}
			});
		} else {
			Log.warn(`Cannot send message, client state: ${client.readyState}, server online: ${this.serverListening}`);
		}
	}

	public sendPush(ah: ActionHandler, pushType: string, data: {}): void {
		const client: WebSocket = ah.client;
		if (client.readyState === client.OPEN && this.serverListening) {
			const push: ResponseOrPushMessage = {
				pushType,
				data
			};
			const pushString = JSON.stringify(push);
			Log.debug(`Send push: ${pushString}`);
			client.send(pushString, (error: Error | undefined) => {
				if (error !== undefined) {
					this.terminateClient(client, "Failed to send message", error);
				}
			});
		} else {
			Log.warn(`Cannot send message, client state: ${client.readyState}, server online: ${this.serverListening}`);
		}
	}

	protected sendError(ah: ActionHandler, responseObject: string, error: string): void {
		const client: WebSocket = ah.client;
		if (client.readyState === client.OPEN && this.serverListening) {
			const errorResponse: ResponseOrPushMessage = {
				error
			};
			if (responseObject !== undefined) {
				errorResponse.id = responseObject;
			}
			Log.debug(`Send error (${responseObject}): ${error}`);
			client.send(JSON.stringify(errorResponse), (sendError: Error | undefined) => {
				if (sendError !== undefined) {
					this.terminateClient(client, "Failed to send message", sendError);
				}
			});
		} else {
			Log.warn(`Cannot send message, client state: ${client.readyState}, server online: ${this.serverListening}`);
		}
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
				//Protocol defines 1001 as server going down.
				client.close(1001, "Server shutting down/restarting.");
				this.terminateClient(client);
			}

			//Close the server.
			return new Promise<void>((resolve) => {
				this.server!.close(() => {
					this.restServer!.close(() => {
						this.serverListening = false;
						this.isClosingServer = false;
						resolve();
					});
				});
			});
		}
	}

	/**
	 * Terminate a client connection. Optionally you can pass an Error of why it closes.
	 * @param client the client to terminate
	 * @param errorDescription If it terminates because of an error a description
	 * @param error If it terminates because of an error the error if any.
	 */
	private terminateClient(client: WebSocket, errorDescription?: string | undefined, error?: Error): void {
		//Some browsers cause an 'read ECONNRESET' to be thrown when refreshing: https://bugs.chromium.org/p/chromium/issues/detail?id=798194#c6
		if (error !== undefined) {
			if (error.message !== "read ECONNRESET") {
				Log.warn(errorDescription !== undefined ? errorDescription : "", error);
			}
		} else if (errorDescription !== undefined) {
			Log.warn(errorDescription, error);
		}
		if (this.actionHandlers.has(client)) {
			this.actionHandlers.get(client)!.terminate();
			client.terminate();
			this.actionHandlers.delete(client);
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