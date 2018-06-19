/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Handler } from "./handlers/handler";

export interface DBTransaction {
	//Unprocessed transaction info
	transaction_id: Buffer;
	version: number;
	contract_hash: Buffer;
	valid_till: number;
	payload: string; //Additional contract specific info
	public_key: Buffer;
	signature: Buffer;
	create_ts?: number | null; //Only if provided and is processor
	status: TransactionStatus; //Will change once processed

	//Processed transaction info
	sender: string | null;
	contract_type: string | null;
	message: string | null;
	block_id: number | null;
	position_in_block: number | null;
	processed_ts: number | null;

	//Additional transaction info
	receiver: string | null;
	extra1: string | null;
	extra2: string | null;
}

export enum TransactionStatus {
	New = "new", ProcessingAccepted = "processing_accepted", ProcessingRejected = "processing_rejected", Invalid = "invalid", Accepted = "accepted", Rejected = "rejected"
}

export enum UpdateReason {
	Id = 0, Address = 1, Global = 2
}

/**
 * The action handler is responsible for dealing with the content of incomming and outgoing messages.
 * Each version of the API should extend the action handler.
 */
export class ActionHandler {
	public readonly client: any;
	protected readonly handler: Handler;
	private readonly messageHandlers = new Map<string, (data?: {}) => Promise<any>>();
	private readonly updateHandlers = Array<(tx: DBTransaction, reason: UpdateReason) => void>();
	private readonly terminationHandlers = Array<() => void>();

	/**
	 * Create a new action handler.
	 * @param handler The handler to create
	 * @param client A client (e.g. a websocket client) that can be passed on to this action handler.
	 * Not optional so that plugins will need to provide it.
	 */
	constructor(handler: Handler, client: any) {
		this.handler = handler;
		this.client = client;
	}

	/** Called after a client is removed. */
	public terminate(): void {
		for (const handler of this.terminationHandlers) {
			handler.call(this);
		}
	}

	/**
	 * Add a new termination handler
	 * @param handler The handler to deal with the termination of this client.
	 */
	protected addTerminationHandler(handler: () => void): void {
		this.terminationHandlers.push(handler);
	}

	/**
	 * Called when there is a new message.
	 * @param type The type of message
	 * @param data The data with the message
	 */
	public receiveMessage(type: string, data: {} | undefined): Promise<any> {
		const responseFunction = this.messageHandlers.get(type);
		if (responseFunction === undefined) {
			return Promise.reject(`Invalid type: ${type}`);
		} else {
			//this is lost if we do not call it this way.
			return responseFunction.call(this, data);
		}
	}

	/**
	 * Add a new message handler.
	 * @param type The type of message
	 * @param handler The handler to deal with the message.
	 */
	protected addMessageHandler(type: string, handler: (data?: {}) => Promise<any>): void {
		this.messageHandlers.set(type, handler);
	}

	/**
	 * Called when there is a transaction the ActionHandler is listening to.
	 * It will only receive a transaction once, even if it is listening to the transaction multiple times.
	 * @param tx The transation
	 * @param reason The reason it receives this update. (Depends on what you are listening to.)
	 */
	public receiveUpdate(tx: DBTransaction, reason: UpdateReason): void {
		for (const handler of this.updateHandlers) {
			handler.call(this, tx, reason);
		}
	}

	/**
	 * Add a new update handler.
	 * @param handler The handler to deal with the update.
	 */
	protected addUpdateHandler(handler: (tx: DBTransaction, reason: UpdateReason) => void): void {
		this.updateHandlers.push(handler);
	}
}