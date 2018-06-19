/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { ActionHandler, DBTransaction, UpdateReason, TransactionStatus } from "../actionhandler";
import { Database } from "../database";
import { BasicRequestTypes, ProcessRequest, TxRequest, Contract, TxResponseOrPush, BasicPushTypes } from "./basicapi";
import { Log } from "../tools/log";
import { Crypto } from "../tools/crypto";

// tslint:disable-next-line:typedef Let typescript determine the type...
export function addBasics<T extends new (...args: any[]) => ActionHandler>(Extend: T) {
	return class Basics extends Extend {
		//All queries to retrieve info from the database
		protected static readonly storeTransaction = "INSERT INTO basics.transactions(version, transaction_id, contract_hash, "
			+ "valid_till, payload, signature, public_key, create_ts) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);";
		protected static readonly getContracts = "SELECT contract_hash, contract_type, contract_version, description, "
			+ "creator, contract_template FROM basics.contracts;";
		protected static readonly getTx = "SELECT * FROM basics.transactions WHERE transaction_id = $1;";
		protected static readonly getTxStatus = "SELECT status FROM basics.transactions WHERE transaction_id = $1;";
		protected static readonly getLatestBlockTs = "SELECT processed_ts FROM basics.blocks ORDER BY block_id DESC LIMIT 1;";

		constructor(...args: any[]) {
			super(...args);
			this.addTerminationHandler(() => Database.get().removeListener(this));
			this.addUpdateHandler(this.basicUpdate);
			this.addMessageHandler(BasicRequestTypes.Contracts, this.contractsMessage);
			this.addMessageHandler(BasicRequestTypes.Process, this.processMessage);
			this.addMessageHandler(BasicRequestTypes.Time, this.timeMessage);
			this.addMessageHandler(BasicRequestTypes.Transaction, this.transactionMessage);
			this.addMessageHandler(BasicRequestTypes.TxStatus, this.txStatusMessage);
		}

		/**
		 * We receive an update from the database about a transaction we were listening to.
		 * @param tx The transaction
		 * @param updateReason Why we received the update (e.g. we were listening to this id, or we were listening to a user address, etc)
		 */
		protected basicUpdate(tx: DBTransaction, updateReason: UpdateReason): void {
			//We receive an update after listening for a transaction id, send a push update to the client
			if (updateReason === UpdateReason.Id) {
				const pushData: TxResponseOrPush = {
					blockId: tx.block_id,
					version: tx.version,
					validTill: tx.valid_till,
					positionInBlock: tx.position_in_block,
					processedTs: tx.processed_ts,
					sender: tx.sender,
					receiver: tx.receiver,
					contractType: tx.contract_type,
					contractHash: Crypto.binaryToHex(tx.contract_hash),
					status: tx.status,
					message: tx.message,
					id: Crypto.binaryToHex(tx.transaction_id),
					createTs: tx.create_ts,
					signature: Crypto.binaryToHex(tx.signature),
					publicKey: Crypto.binaryToHex(tx.public_key),
					payload: tx.payload,
					extra1: tx.extra1,
					extra2: tx.extra2
				};
				this.handler.sendPush(this, BasicPushTypes.Transaction, pushData);
			}
		}

		/** We were requested to process a new transaction from the client. */
		protected async processMessage(data?: ProcessRequest): Promise<void> {
			//Check if all required arguments are there and correct
			if (typeof data !== "object" || (data.createTs !== undefined && !Number.isSafeInteger(data.createTs))
				|| typeof data.base64tx !== "string" || !Crypto.isBase64(data.base64tx)) {

				return Promise.reject("Missing or invalid request data parameters.");
			}

			//Check if the transaction format is correct
			const tx = Crypto.base64ToBinary(data.base64tx);
			if (tx.length < 158 || tx.length > 100158) {
				return Promise.reject("Invalid transaction format.");
			}

			//Fill in all fields for our database.
			const params: any[] = [
				Crypto.binaryToUInt8(tx.slice(4, 5)), //Version
				tx.slice(5, 21), //id
				tx.slice(21, 53), //contract hash
				Crypto.binaryToULong(tx.slice(53, 61)), //Valid till
				Crypto.binaryToUtf8(tx.slice(61, -97)), //payload
				tx.slice(-97, -33), //signature
				tx.slice(-33), //public key
				data.createTs
			];

			//Store the transaction in the DB (make sure to use values to avoid sql injections)
			try {
				await Database.get().query({ text: Basics.storeTransaction, values: params });
				Promise.resolve();
			} catch (error) {
				if (error.message.indexOf("duplicate key") !== -1) {
					//There is already a transaction with this id
					return Promise.reject("Transaction with id already exists.");
				} else {
					//Something went wrong, do not send a detailed report to the client for security reasons
					Log.warn("Failed to store transaction.", error);
					return Promise.reject("Invalid format or unable to store transaction.");
				}
			}
		}

		/** The client requests the smart contracts that are available. */
		protected async contractsMessage(): Promise<Contract[]> {
			//Get all contracts
			try {
				const result = await Database.get().query({ text: Basics.getContracts });
				const responseData: Contract[] = [];
				for (const row of result.rows) {
					responseData.push({
						type: row.contract_type,
						hash: Crypto.binaryToHex(row.contract_hash),
						version: row.contract_version,
						description: row.description,
						template: row.contract_template
					});
				}
				return Promise.resolve(responseData);
			} catch (error) {
				//We were unable to retrieve the contracts, do not send a detailed error for security reasons.
				Log.warn("Failed to retrieve contracts", error);
				return Promise.reject("Failed to retrieve contracts.");
			}
		}

		/** The client requests the status of a certain transaction. */
		protected async txStatusMessage(data?: TxRequest): Promise<string | undefined> {
			//Check if all data is correct
			if (typeof data !== "object" || (data.push !== undefined && typeof data.push !== "boolean") ||
				typeof data.txId !== "string" || !Crypto.isHex(data.txId)) {
				return Promise.reject("Missing or invalid request data parameters.");
			}

			try {
				const binaryTxId = Crypto.hexToBinary(data.txId);
				//Get the transaction status form the database (make sure to use values to avoid sql injections)
				const result = await Database.get().query({ text: Basics.getTxStatus, values: [binaryTxId] });
				let responseData: string | undefined;
				if (result.rows.length === 0 || result.rows[0].status === TransactionStatus.New ||
					result.rows[0].status === TransactionStatus.ProcessingAccepted || result.rows[0].status === TransactionStatus.ProcessingRejected) {
					//If the transaction does not exist or has not yet been processed:
					//If user required to receive a push message in case it wasn't available register ourselfs for this transaction
					if (data.push === true) {
						Database.get().addListener(this, binaryTxId);
					}
				} else {
					//If the transaction exist and has been processed:
					responseData = result.rows[0].status;
				}
				return Promise.resolve(responseData);
			} catch (error) {
				//We were unable to retrieve the transaction status, do not send a detailed error for security reasons.
				Log.warn("Failed to retrieve transaction status", error);
				return Promise.reject("Unable to retrieve transaction status.");
			}
		}

		/** The client requests the full transaction info. */
		protected async transactionMessage(data?: TxRequest): Promise<TxResponseOrPush | undefined> {
			//Check if all data is correct
			if (typeof data !== "object" || (data.push !== undefined && typeof data.push !== "boolean") ||
				typeof data.txId !== "string" || !Crypto.isHex(data.txId)) {
				return Promise.reject("Missing or invalid request data parameters.");
			}

			try {
				const binaryTxId = Crypto.hexToBinary(data.txId);
				//Get the transaction form the database (make sure to use values to avoid sql injections)
				const result = await Database.get().query({ text: Basics.getTx, values: [binaryTxId] });
				let responseData: TxResponseOrPush | undefined;
				const dbTransaction: DBTransaction | undefined = result.rows[0];
				if (dbTransaction === undefined || dbTransaction.status === TransactionStatus.New ||
					dbTransaction.status === TransactionStatus.ProcessingAccepted || dbTransaction.status === TransactionStatus.ProcessingRejected) {
					//If the transaction does not exist or has not yet been processed:
					//If user required to receive a push message in case it wasn't available register ourselfs for this transaction
					if (data.push === true) {
						Database.get().addListener(this, binaryTxId);
					}
				} else {
					//If the transaction exist and has been processed:
					responseData = {
						blockId: dbTransaction.block_id,
						version: dbTransaction.version,
						validTill: dbTransaction.valid_till,
						positionInBlock: dbTransaction.position_in_block,
						processedTs: dbTransaction.processed_ts,
						sender: dbTransaction.sender,
						receiver: dbTransaction.receiver,
						contractType: dbTransaction.contract_type,
						contractHash: Crypto.binaryToHex(dbTransaction.contract_hash),
						status: dbTransaction.status,
						message: dbTransaction.message,
						id: Crypto.binaryToHex(dbTransaction.transaction_id),
						createTs: dbTransaction.create_ts,
						signature: Crypto.binaryToHex(dbTransaction.signature),
						publicKey: Crypto.binaryToHex(dbTransaction.public_key),
						payload: dbTransaction.payload,
						extra1: dbTransaction.extra1,
						extra2: dbTransaction.extra2
					};
				}
				return Promise.resolve(responseData);
			} catch (error) {
				//We were unable to retrieve the transaction, do not send a detailed error for security reasons.
				Log.warn("Failed to retrieve transaction", error);
				return Promise.reject("Unable to retrieve transaction.");
			}
		}

		/** The client requests the time of the most recent block. */
		protected async timeMessage(): Promise<number> {
			try {
				const result = await Database.get().query({ text: Basics.getLatestBlockTs});
				if (result.rows.length > 0) {
					return Promise.resolve(result.rows[0].processed_ts);
				} else {
					//If our database is still empty.
					return Promise.reject("No existing blocks found.");
				}
			} catch (error) {
				Log.warn("Unable to retrieve latest block from database.", error);
				return Promise.reject("Unable to retrieve latest block from database.");
			}
		}
	};
}