/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

// tslint:disable:no-null-keyword
import { Database, Log, ActionHandler, addBasics, Handler, Config, DBTransaction } from "validana-server";
import { RequestType, AddrInfo, EndorserBadge, EndorserBadgeClass, EndorsedBadge, EndorsedBadgeClass } from "./surfapiV1";
import { ExtraConfig } from ".";

/** A handler to deal with incomming messages. */
export default class SurfHandlerV1 extends addBasics(ActionHandler) {
	private allPush: boolean = false;

	//All endorsers for a badge(class)
	protected static readonly getBadgeEndorsers = "SELECT id, entity, json, issued_on FROM endorsementbadges WHERE badge = $1;";
	protected static readonly getBadgeClassEndorsers = "SELECT id, entity, json, issued_on, revoked FROM endorsementclasses WHERE class = $1;";
	//All badge(classes) endorsed by someone
	protected static readonly getEndorsementsBadge = "SELECT id, badge, json, issued_on FROM endorsementbadges WHERE entity = $1;";
	protected static readonly getEndorsementsBadgeClass = "SELECT id, class, json, issued_on, revoked FROM endorsementclasses WHERE entity = $1;";
	//The badge(class)(endorsement) itsself
	protected static readonly getBadge = "SELECT json, data FROM badges WHERE id = $1;";
	protected static readonly getBadgeClass = "SELECT json, data FROM badgeclasses WHERE id = $1;";
	protected static readonly getBadgeEndorsement = "SELECT json FROM endorsementbadges WHERE id = $1;";
	protected static readonly getBadgeClassEndorsement = "SELECT json, revoked FROM endorsementclasses WHERE id = $1;";
	//Other info
	protected static readonly getInstitutions = "SELECT institution FROM institutions;";
	protected static readonly getInstitution = "SELECT institution FROM entities WHERE entity = $1;";
	protected static readonly getEntities = "SELECT entity FROM entities WHERE institution = $1;";
	protected static readonly getAddrInfo = "SELECT entities.entity, institution, revoked, name, start_time, end_time " +
		"FROM entities, entity_names WHERE entities.entity = entity_names.entity AND entities.entity = ANY($1);";
	protected static readonly getAddrInfo2 = "SELECT institutions.institution, iri, revoked, name, start_time, end_time " +
		"FROM institutions, institution_names WHERE institutions.institution = institution_names.institution AND institutions.institution = ANY($1);";

	constructor(handler: Handler, client: any) {
		super(handler, client);
		//All endorsers for a badge(class)
		this.addMessageHandler(RequestType.EndorsersBadge, this.endorsersBadgeMessage);
		this.addMessageHandler(RequestType.EndorsersBadgeClass, this.endorsersBadgeClassMessage);
		//All badge(classes) endorsed by someone
		this.addMessageHandler(RequestType.EndorsedBadges, this.endorsedBadgesMessage);
		this.addMessageHandler(RequestType.EndorsedBadgeClasses, this.endorsedBadgeClassesMessage);
		//The badge(class)(endorsement) itsself
		this.addMessageHandler(RequestType.Badge, this.badgeMessage);
		this.addMessageHandler(RequestType.BadgeClass, this.badgeClassMessage);
		this.addMessageHandler(RequestType.EndorsementBadge, this.endorsementBadgeMessage);
		this.addMessageHandler(RequestType.EndorsementBadgeClass, this.endorsementBadgeClassMessage);
		//Other info
		this.addMessageHandler(RequestType.Institutions, this.institutionsMessage);
		this.addMessageHandler(RequestType.Institution, this.institutionMessage);
		this.addMessageHandler(RequestType.Entities, this.entitiesMessage);
		this.addMessageHandler(RequestType.RootInfo, this.rootInfoMessage);
		this.addMessageHandler(RequestType.AddrInfo, this.addrInfoMessage);
		//Listen to all blockchain transactions
		this.addMessageHandler(RequestType.AllPush, this.allPushMessage);
	}

	protected async endorsersBadgeMessage(data?: string): Promise<EndorserBadge[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get all endorsers of a badge
			const result = await Database.get().query({ text: SurfHandlerV1.getBadgeEndorsers, values: [data] });
			return Promise.resolve(result.rows);
		} catch (error) {
			Log.warn("Failed to retrieve badge endorsers", error);
			return Promise.reject("Unable to retrieve badge endorsers.");
		}
	}

	protected async endorsersBadgeClassMessage(data?: string): Promise<EndorserBadgeClass[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get all endorsers of a badge class
			const result = await Database.get().query({ text: SurfHandlerV1.getBadgeClassEndorsers, values: [data] });
			return Promise.resolve(result.rows);
		} catch (error) {
			Log.warn("Failed to retrieve badge class endorsers", error);
			return Promise.reject("Unable to retrieve badge class endorsers.");
		}
	}

	protected async endorsedBadgesMessage(data?: string): Promise<EndorsedBadge[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get all badges endorsed by some entity
			const result = await Database.get().query({ text: SurfHandlerV1.getEndorsementsBadge, values: [data] });
			return Promise.resolve(result.rows);
		} catch (error) {
			Log.warn("Failed to retrieve badge endorsements", error);
			return Promise.reject("Unable to retrieve endorsements.");
		}
	}

	protected async endorsedBadgeClassesMessage(data?: string): Promise<EndorsedBadgeClass[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get all badge classes endorsed by some entity
			const result = await Database.get().query({ text: SurfHandlerV1.getEndorsementsBadgeClass, values: [data] });
			return Promise.resolve(result.rows);
		} catch (error) {
			Log.warn("Failed to retrieve badge class endorsements", error);
			return Promise.reject("Unable to retrieve endorsements.");
		}
	}

	protected async badgeMessage(badgeId: string): Promise<string> {
		if (typeof badgeId !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = (await Database.get().query({ text: SurfHandlerV1.getBadge, values: [badgeId] })).rows[0];
			if (result === undefined) {
				return Promise.reject("Badge does not exist.");
			}
			return Promise.resolve(result.data === null ? result.json : result.data);
		} catch (error) {
			Log.warn("Failed to retrieve badge", error);
			return Promise.reject("Unable to retrieve badge.");
		}
	}

	protected async badgeClassMessage(badgeClassId: string): Promise<string> {
		if (typeof badgeClassId !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = (await Database.get().query({ text: SurfHandlerV1.getBadgeClass, values: [badgeClassId] })).rows[0];
			if (result === undefined) {
				return Promise.reject("Badge class does not exist.");
			}
			return Promise.resolve(result.data === null ? result.json : result.data);
		} catch (error) {
			Log.warn("Failed to retrieve badge class", error);
			return Promise.reject("Unable to retrieve badge class.");
		}
	}

	protected async endorsementBadgeMessage(endorsementId: number): Promise<object> {
		if (typeof endorsementId !== "number") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = (await Database.get().query({ text: SurfHandlerV1.getBadgeEndorsement, values: [endorsementId] })).rows[0];
			if (result === undefined) {
				return Promise.reject("Badge does not exist.");
			}
			return Promise.resolve(result.json);
		} catch (error) {
			Log.warn("Failed to retrieve badge endorsement", error);
			return Promise.reject("Unable to retrieve badge endorsement.");
		}
	}

	protected async endorsementBadgeClassMessage(endorsementId: number): Promise<object> {
		if (typeof endorsementId !== "number") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = (await Database.get().query({ text: SurfHandlerV1.getBadgeClassEndorsement, values: [endorsementId] })).rows[0];
			if (result === undefined) {
				return Promise.reject("Badge class does not exist.");
			}
			if (result.revoked !== null) {
				return Promise.reject("Badge class endorsement has been revoked.");
			}
			return Promise.resolve(result.json);
		} catch (error) {
			Log.warn("Failed to retrieve badge class", error);
			return Promise.reject("Unable to retrieve badge class.");
		}
	}

	protected async institutionsMessage(): Promise<string[]> {
		try {
			const result = await Database.get().query({ text: SurfHandlerV1.getInstitutions });
			const responseData: string[] = [];
			//Add all entities to the response
			for (const row of result.rows) {
				responseData.push(row.institution);
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve institutions", error);
			return Promise.reject("Unable to retrieve institutions.");
		}
	}

	protected async institutionMessage(data?: string): Promise<string | undefined> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = await Database.get().query({ text: SurfHandlerV1.getInstitution, values: [data] });
			const responseData: string | undefined = result.rows.length === 0 ? undefined : result.rows[0].institution;
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve institution", error);
			return Promise.reject("Unable to retrieve institution.");
		}
	}

	protected async entitiesMessage(data?: string): Promise<string[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = await Database.get().query({ text: SurfHandlerV1.getEntities, values: [data] });
			const responseData: string[] = [];
			//Add all entities to the response
			for (const row of result.rows) {
				responseData.push(row.entity);
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve entities", error);
			return Promise.reject("Unable to retrieve entities.");
		}
	}

	protected async rootInfoMessage(): Promise<AddrInfo> {
		return Promise.resolve({
			addr: Config.get<ExtraConfig>().VSERVER_ADDR,
			names: [{
				name: Config.get<ExtraConfig>().VSERVER_NAME,
				startTime: 0,
				endTime: null
			}],
			revokedTime: null,
			type: "processor"
		} as AddrInfo);
	}

	protected async addrInfoMessage(data?: string[]): Promise<AddrInfo[]> {
		if (!(data instanceof Array) || data.find((value) => typeof value !== "string") !== undefined) {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get the name of all entities in data
			const resultEntities = await Database.get().query({ text: SurfHandlerV1.getAddrInfo, values: [data] });
			try {
				//Get the name of all institutions in data
				const resultInstitutions = await Database.get().query({ text: SurfHandlerV1.getAddrInfo2, values: [data] });
				const responseData = new Map<string, AddrInfo>();
				//Add all entities to the response
				for (const row of resultEntities.rows) {
					if (!responseData.has(row.entity)) {
						responseData.set(row.entity, {
							addr: row.entity,
							names: [],
							parent: row.institution,
							revokedTime: row.revoked,
							type: "entity"
						});
					}
					responseData.get(row.entity)!.names.push({
						name: row.name,
						startTime: row.start_time,
						endTime: row.end_time
					});
				}
				//Add all institutions to the response
				for (const row of resultInstitutions.rows) {
					if (!responseData.has(row.institution)) {
						responseData.set(row.institution, {
							addr: row.institution,
							names: [],
							parent: Config.get<ExtraConfig>().VSERVER_ADDR,
							revokedTime: row.revoked,
							iri: row.iri,
							type: "institution"
						});
					}
					responseData.get(row.institution)!.names.push({
						name: row.name,
						startTime: row.start_time,
						endTime: row.end_time
					});
				}
				//Add processor to response if needed
				if (data.indexOf(Config.get<ExtraConfig>().VSERVER_ADDR) !== -1) {
					responseData.set(Config.get<ExtraConfig>().VSERVER_ADDR, {
						addr: Config.get<ExtraConfig>().VSERVER_ADDR,
						names: [{
							name: Config.get<ExtraConfig>().VSERVER_NAME,
							startTime: 0,
							endTime: null
						}],
						revokedTime: null,
						type: "processor"
					});
				}
				//Sort all names on new to old
				for (const resultRow of responseData.values()) {
					resultRow.names.sort((a, b) => b.startTime - a.startTime);
				}
				return Promise.resolve(Array.from(responseData.values()));
			} catch (error) {
				Log.warn("Failed to retrieve address info for institutions.", error);
				return Promise.reject("Unable to retrieve address info.");
			}
		} catch (error) {
			Log.warn("Failed to retrieve address info for entities.", error);
			return Promise.reject("Unable to retrieve address info.");
		}
	}

	/** Register to receive push messages for all transactions. */
	protected async allPushMessage(): Promise<void> {
		if (!this.allPush) {
			this.allPush = true;
			Database.get().addListener(this);
			this.addUpdateHandler(this.allPushHandler);
		}
	}

	/** Send the push messages with type "all". */
	protected allPushHandler(tx: DBTransaction): void {
		this.handler.sendPush(this, "all", tx);
	}
}