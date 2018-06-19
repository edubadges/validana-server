/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import * as Path from "path";
import { Worker } from "cluster";
import { Config } from "../config";
import { ActionHandler } from "../actionhandler";

export abstract class Handler {
	protected readonly worker: Worker;
	protected readonly port: number;

	/**
	 * Cannot contain 'typeof ActionHandler' directly, because they are abstract,
	 * so we tell it that it contains something that can create an ActionHandler.
	 */
	protected readonly apiVersions = new Map<string, typeof ActionHandler>();

	constructor(worker: Worker, port: number) {
		this.worker = worker;
		this.port = port;

		//Add all versions of the API that we support and their url.
		const apis: { [api: string]: string } = JSON.parse(Config.get().VSERVER_API);
		for (const apiName of Object.keys(apis)) {
			//Require the file, which should have a default exported class that extends actionHandler.
			const apiFile = require(Path.resolve(apis[apiName]));
			//Map the api name to the constructor of the exported class
			this.apiVersions.set(apiName, apiFile.default);
		}
	}

	/**
	 * Send a response to the user.
	 * @param ah the actionHandler which sends the message
	 * @param responseObject the response object given for the requests
	 * @param data Optional data to send along with the response
	 */
	protected abstract sendResponse(ah: ActionHandler, responseObject: {}, data?: {}): void;

	/**
	 * Send a push message to the user.
	 * @param ah the actionHandler which sends the push
	 * @param pushType the type of push we are doing
	 * @param data the data you want to push
	 */
	public abstract sendPush(ah: ActionHandler, pushType: string, data: {}): void;

	/**
	 * Send an error to the user.
	 * @param ah the actionHandler which sends the error
	 * @param responseObject the response object given for the request
	 * @param error a description of the error. (Be careful what you send to the client as it may result in security issues!)
	 */
	protected abstract sendError(ah: ActionHandler, responseObject: {}, error: string): void;

	/**
	 * Shutdown the server. If it is being closed permanently it should never reject.
	 * @param permanent Should the server permanently stay down or not.
	 */
	public abstract async shutdownServer(permanent: boolean): Promise<void>;
}