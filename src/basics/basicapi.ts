/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

/**
 * Some basic requests, recommended for any actionhandler:
 * Process: ProcessRequest, no data
 * Contracts: no request data, Contract[]
 * Transaction: TxRequest, TxResponseOrPush | undefined, may result in pushtransaction: Transaction with data TxResponseOrPush
 * TxStatus: TxRequest, string | undefined, may result in pushtransaction: Transaction with data TxResponseOrPush
 * Time: no request data, number | undefined
 */
export enum BasicRequestTypes {
	Process = "process",
	Contracts = "contracts",
	Transaction = "transaction",
	TxStatus = "txStatus",
	Time = "time"
}

/**
 * Possible push actions with their data:
 * Transaction: TxResponseOrPush
 */
export enum BasicPushTypes {
	Transaction = "transaction"
}

//The possible request, reponse and push data you can expect.
export type RequestData = ProcessRequest | TxRequest | undefined;
export type ReponseData = Contract[] | TxResponseOrPush | undefined;
export type PushData = TxResponseOrPush;

export interface ProcessRequest {
	base64tx: string; //The actual transaction (in base64 format)
	createTs?: number; //Optional info about when it was created
}

export interface TxRequest {
	txId: string; //transactionId (hex)
	push?: boolean; //If the transaction does not exist, do you want to receive a push message once it does? (websocket only)
}

export interface Contract {
	type: string;
	hash: string;
	version: string;
	description: string;
	template: {
		[fieldType: string]: FieldType;
	};
}

export interface FieldType {
	type: string; //Field Type
	description: string; //Field suggested description
	name: string; //Field suggested name
}

export interface TxResponseOrPush {
	//Transaction info
	id: string;
	version: number;
	contractHash: string;
	validTill: number;
	payload: string;
	publicKey: string;
	signature: string;
	status: string;
	createTs?: number | null;
	//Processed transaction info (if valid)
	sender: string | null;
	contractType: string | null;
	message: string | null;
	blockId: number | null;
	positionInBlock: number | null;
	processedTs: number | null;
	//Optional info once processed
	receiver: string | null;
	extra1: string | null;
	extra2: string | null;
}