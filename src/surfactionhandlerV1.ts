/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Database, Log, Crypto, ActionHandler, addBasics, Handler, Config } from "validana-server";
import { RequestType, BadgeClass, AddrInfo } from "./surfapiV1";
import { ExtraConfig } from ".";

/** A handler to deal with incomming messages. */
export default class SurfHandlerV1 extends addBasics(ActionHandler) {
	//All queries to retrieve info from the database
	protected static readonly getBadgeClasses = "SELECT class FROM badgeclasses;";
	protected static readonly getBadgeEndorsers = "SELECT entity FROM endorsebadges WHERE badge = $1;";
	protected static readonly getBadgeClassEndorsers = "SELECT entity FROM endorseclasses WHERE class = $1 AND endorsed = true;";
	protected static readonly getBadgeClassInfo = "SELECT * FROM badgeclasses WHERE class = ANY($1);";
	protected static readonly getEndorsementsBadge = "SELECT badge FROM endorsebadges WHERE entity = $1;";
	protected static readonly getEndorsementsBadgeClass = "SELECT class FROM endorseclasses WHERE entity = $1 AND endorsed = true;";
	protected static readonly getInstitution = "SELECT institution FROM entities WHERE entity = $1;";
	protected static readonly getEntities = "SELECT entity FROM entities WHERE institution = $1;";
	protected static readonly getInstitutions = "SELECT institution FROM institutions;";
	protected static readonly getAddrInfo = "SELECT * FROM entities WHERE entity = ANY($1);";
	protected static readonly getAddrInfo2 = "SELECT * FROM institutions WHERE institution = ANY($1);";

	constructor(handler: Handler, client: any) {
		super(handler, client);
		this.addMessageHandler(RequestType.BadgeClasses, this.badgeClassesMessage);
		this.addMessageHandler(RequestType.EndorsersBadge, this.endorsersBadgeMessage);
		this.addMessageHandler(RequestType.EndorsersBadgeClass, this.endorsersBadgeClassMessage);
		this.addMessageHandler(RequestType.EndorsedBadges, this.endorsedBadgesMessage);
		this.addMessageHandler(RequestType.EndorsedBadgeClasses, this.endorsedBadgeClassesMessage);
		this.addMessageHandler(RequestType.BadgeClassInfo, this.badgeClassInfoMessage);
		this.addMessageHandler(RequestType.Entities, this.entitiesMessage);
		this.addMessageHandler(RequestType.Institution, this.institutionMessage);
		this.addMessageHandler(RequestType.Institutions, this.institutionsMessage);
		this.addMessageHandler(RequestType.AddrInfo, this.addrInfoMessage);
		this.addMessageHandler(RequestType.RootInfo, this.rootInfoMessage);
	}

	protected async badgeClassesMessage(): Promise<BadgeClass[]> {
		try {
			const result = await Database.get().query({ text: SurfHandlerV1.getBadgeClasses });

			const responseData: BadgeClass[] = [];
			//Add all existing badge classes to the response
			for (const row of result.rows) {
				responseData.push(row.class);
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve all badge classes", error);
			return Promise.reject("Unable to retrieve badge classes.");
		}
	}

	protected async endorsersBadgeMessage(data?: string): Promise<string[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = await Database.get().query({ text: SurfHandlerV1.getBadgeEndorsers, values: [data] });
			const responseData: string[] = [];
			//Add all endorsers to the response
			for (const row of result.rows) {
				responseData.push(row.entity);
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve badge endorsers", error);
			return Promise.reject("Unable to retrieve badge endorsers.");
		}
	}

	protected async endorsersBadgeClassMessage(data?: string): Promise<string[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			const result = await Database.get().query({ text: SurfHandlerV1.getBadgeClassEndorsers, values: [data] });
			const responseData: string[] = [];
			//Add all endorsers to the response
			for (const row of result.rows) {
				responseData.push(row.entity);
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve badge class endorsers", error);
			return Promise.reject("Unable to retrieve badge class endorsers.");
		}
	}

	protected async endorsedBadgesMessage(data?: string): Promise<string[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get all endorsed badge classes
			const result = await Database.get().query({ text: SurfHandlerV1.getEndorsementsBadge, values: [data] });
			const responseData: string[] = [];
			//Add all badge classes to the response
			for (const row of result.rows) {
				responseData.push(Crypto.binaryToHex(row.badge));
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve badge endorsements", error);
			return Promise.reject("Unable to retrieve endorsements.");
		}
	}

	protected async endorsedBadgeClassesMessage(data?: string): Promise<BadgeClass[]> {
		if (typeof data !== "string") {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get all endorsed badge classes
			const result = await Database.get().query({ text: SurfHandlerV1.getEndorsementsBadgeClass, values: [data] });
			const responseData: BadgeClass[] = [];
			//Add all badge classes to the response
			for (const row of result.rows) {
				responseData.push(row.class);
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve badge class endorsements", error);
			return Promise.reject("Unable to retrieve endorsements.");
		}
	}

	protected async badgeClassInfoMessage(data?: string[]): Promise<BadgeClass[]> {
		if (!(data instanceof Array) || data.find((value) => typeof value !== "string") !== undefined) {
			return Promise.reject("Missing or invalid request data parameters.");
		}

		try {
			//Get information about all the badges that were provided
			const result = await Database.get().query({ text: SurfHandlerV1.getBadgeClassInfo, values: [data] });
			const responseData: BadgeClass[] = [];
			//Add all entities to the response
			for (const row of result.rows) {
				responseData.push({
					badgeClass: row.class,
					metadata: row.metadata,
					firstEndorser: row.first_endorser
				});
			}
			return Promise.resolve(responseData);
		} catch (error) {
			Log.warn("Failed to retrieve badge class info", error);
			return Promise.reject("Unable to retrieve badge class info.");
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
				const responseData: AddrInfo[] = [];
				//Add all entities to the response
				for (const row of resultEntities.rows) {
					responseData.push({
						addr: row.entity,
						name: row.name,
						parent: row.institution,
						withdrawn: !row.allowed,
						type: "entity"
					});
				}
				//Add all institutions to the response
				for (const row of resultInstitutions.rows) {
					responseData.push({
						addr: row.institution,
						name: row.name,
						parent: Config.get<ExtraConfig>().VSERVER_ADDR,
						withdrawn: !row.allowed,
						type: "institution"
					});
				}
				//Add processor to response if needed
				if (data.indexOf(Config.get<ExtraConfig>().VSERVER_ADDR) !== -1) {
					responseData.push({
						addr: Config.get<ExtraConfig>().VSERVER_ADDR,
						name: Config.get<ExtraConfig>().VSERVER_NAME,
						withdrawn: false,
						type: "processor"
					});
				}
				return Promise.resolve(responseData);
			} catch (error) {
				Log.warn("Failed to retrieve address info for institutions.", error);
				return Promise.reject("Unable to retrieve address info.");
			}
		} catch (error) {
			Log.warn("Failed to retrieve address info for entities.", error);
			return Promise.reject("Unable to retrieve address info.");
		}
	}

	protected rootInfoMessage(): Promise<AddrInfo> {
		return Promise.resolve({
			addr: Config.get<ExtraConfig>().VSERVER_ADDR,
			name: Config.get<ExtraConfig>().VSERVER_NAME,
			withdrawn: false,
			type: "processor"
		} as AddrInfo);
	}
}