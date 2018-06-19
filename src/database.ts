/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { ActionHandler, DBTransaction, UpdateReason } from "./actionhandler";
import { Log } from "./tools/log";
import { Client, QueryResult, QueryConfig, types } from "pg";
import { Config } from "./config";
import { Worker } from "cluster";

//Parser for bigint types, which by default is a string (due to information loss with numbers).
types.setTypeParser(20, (val: string) => {
	return Number.parseInt(val, 10);
});

/** The database class is responsible for interacting with the blockchain and updating listeners. */
export class Database {
	public static instance: Database | undefined;
	private static readonly getLatest = "SELECT processed_ts, block_id FROM basics.transactions ORDER BY processed_ts DESC NULLS LAST LIMIT 1;";
	private static readonly getNew = "SELECT * FROM basics.transactions WHERE processed_ts > $1;";

	//The database client
	private client: Client | undefined;
	private isUpdating = false;
	private failures = 0;
	//Latest transaction that was processed
	private latestProcessedTs: number | undefined;

	//The worker to call back for updates
	private worker: Worker | undefined;

	//Map of actionHandlers listening to identifier (eighter a transaction_id, an address or null for global)
	private AHToIdentifier = new Map<ActionHandler, Array<string | undefined>>();
	//Map of identifiers to actionHandlers
	private identifierToAH = new Map<string | undefined, ActionHandler[]>();

	/** Get the Database instance. */
	public static get(): Database {
		if (this.instance === undefined) {
			this.instance = new Database();
		}
		return this.instance;
	}

	public init(worker: Worker): void {
		this.worker = worker;
		setInterval(() => this.checkForUpdates(), Config.get().VSERVER_UPDATEINTERVAL * 1000);
		//Update right away
		this.checkForUpdates();
	}

	/**
	 * Query the database. Will connect to the database if it is not currently connected.
	 * @param queryConfig The query to execute
	 */
	public async query(queryConfig: QueryConfig): Promise<QueryResult> {
		if (this.client === undefined) {
			this.client = new Client({
				user: Config.get().VSERVER_DBUSER,
				database: Config.get().VSERVER_DBNAME,
				password: Config.get().VSERVER_DBPASSWORD,
				port: Config.get().VSERVER_DBPORT,
				host: Config.get().VSERVER_DBHOST
			}).on("error", (error) => {
				this.client = undefined;
				//Do not accidentally capture password
				error.message = error.message.replace(new RegExp(Config.get().VSERVER_DBPASSWORD!, "g"), "");
				Log.warn("Problem with database connection.", error);
			}).on("end", () => this.client = undefined);
			await this.client.connect();
		}
		return this.client.query(queryConfig);
	}

	/** Add a listener for any new transactions */
	public addListener(actionHandler: ActionHandler): void;
	/* Add a listener for the transaction with transactionId. */
	public addListener(actionHandler: ActionHandler, transactionId: Buffer): void;
	/* Add a listener for transactions where sender/receiver is the address. */
	public addListener(actionHandler: ActionHandler, address: string): void;
	public addListener(actionHandler: ActionHandler, idOrAddress?: string | Buffer): void {
		if (idOrAddress instanceof Buffer) {
			idOrAddress = idOrAddress.toString();
		}

		if (actionHandler === undefined) { //TODO
			Log.error("no action handler", new Error());
		}

		//Check if it doesn't exist yet.
		if (!this.AHToIdentifier.has(actionHandler)) {
			this.AHToIdentifier.set(actionHandler, [idOrAddress]);
		} else if (this.AHToIdentifier.get(actionHandler)!.indexOf(idOrAddress) === -1) {
			this.AHToIdentifier.get(actionHandler)!.push(idOrAddress);
		} else {
			//It already exists
			return;
		}

		if (!this.identifierToAH.has(idOrAddress)) {
			this.identifierToAH.set(idOrAddress, [actionHandler]);
		} else if (this.identifierToAH.get(idOrAddress)!.indexOf(actionHandler) === -1) {
			this.identifierToAH.get(idOrAddress)!.push(actionHandler);
		}
	}

	/**
	 * Removes a listener.
	 * @param actionHandler The ActionHandler to remove
	 */
	public removeListener(actionHandler: ActionHandler): void {
		//If we have this actionHandler listening to push updates
		const AHMap = this.AHToIdentifier.get(actionHandler);
		if (AHMap !== undefined) {
			for (const identifier of AHMap) {
				const identifierMap = this.identifierToAH.get(identifier)!;
				identifierMap.splice(identifierMap.indexOf(actionHandler), 1);
				if (identifierMap.length === 0) {
					this.identifierToAH.delete(identifier);
				}
			}
			this.AHToIdentifier.delete(actionHandler);
		}
	}

	/**
	 * Check if there are new transactions that have been put in a block.
	 * If so notify any listeners that are interested in that transaction.
	 */
	private async checkForUpdates(): Promise<void> {
		//Check if it is currently updating, if not exit
		if (this.isUpdating) {
			this.failures++;
			Log.warn(`Backend under heavy load, number of failures: ${this.failures}`);
			return;
		}

		this.isUpdating = true;

		//Check if we already have a latest processedTs
		if (this.latestProcessedTs === undefined) {
			try {
				const result = await this.query({ text: Database.getLatest });
				//No transactions yet
				this.latestProcessedTs = result.rows.length === 0 ? -1 : result.rows[0].processed_ts;
			} catch (error) {
				Log.warn("Failed to retrieve latest transaction", error);
				this.failures++;
				this.isUpdating = false;
				return;
			}
		}

		//If we already have a blockId start retrieving new transactions
		try {
			const result = await this.query({ text: Database.getNew, values: [this.latestProcessedTs] });
			for (const row of result.rows as DBTransaction[]) {
				//update all listeners (never more than once for a transaction, even if registered multiple times)
				const notifiedActionHandlers: ActionHandler[] = [];

				//All id listeners, they are removed once notified.
				const transactionIdString = row.transaction_id.toString();
				if (this.identifierToAH.has(transactionIdString)) {
					for (const ah of this.identifierToAH.get(transactionIdString)!) {
						notifiedActionHandlers.push(ah);
						ah.receiveUpdate(row, UpdateReason.Id);
						this.AHToIdentifier.get(ah)!.splice(this.AHToIdentifier.get(ah)!.indexOf(transactionIdString), 1);
					}
					this.identifierToAH.delete(transactionIdString);
				}

				//All address listeners
				if (this.identifierToAH.has(row.sender!)) {
					for (const addressListener of this.identifierToAH.get(row.sender!)!) {
						if (notifiedActionHandlers.indexOf(addressListener) === -1) {
							notifiedActionHandlers.push(addressListener);
							addressListener.receiveUpdate(row, UpdateReason.Address);
						}
					}
				}
				if (this.identifierToAH.has(row.receiver!)) {
					for (const addressListener of this.identifierToAH.get(row.receiver!)!) {
						if (notifiedActionHandlers.indexOf(addressListener) === -1) {
							notifiedActionHandlers.push(addressListener);
							addressListener.receiveUpdate(row, UpdateReason.Address);
						}
					}
				}

				//Global listener
				if (this.identifierToAH.has(undefined)) {
					for (const addressListener of this.identifierToAH.get(undefined)!) {
						if (notifiedActionHandlers.indexOf(addressListener) === -1) {
							notifiedActionHandlers.push(addressListener);
							addressListener.receiveUpdate(row, UpdateReason.Global);
						}
					}
				}

				//Update latestProcessedTs and latestBlockTs
				if (row.processed_ts! > this.latestProcessedTs!) {
					this.latestProcessedTs = row.processed_ts!;
				}
			}
			this.failures = 0;
			this.isUpdating = false;
			this.worker!.send({ type: "report", memory: process.memoryUsage().heapTotal / 1024 / 1024 });
		} catch (error) {
			Log.warn("Failed to retrieve new transactions", error);
			this.failures++;
			this.isUpdating = false;
		}
	}
}