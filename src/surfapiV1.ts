/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

/**
 * Possible request actions with their request data and responses:
 * BadgeClasses: no request data, string[]
 * EndorsersBadge: string, string[]
 * EndorsersBadgeClass: string, string[]
 * EndorsedBadges: string, string[]
 * EndorsedBadgeClasses: string, string[]
 * Entities: string, string[]
 * Institution: string, string | undefined
 * Institutions: no request data, string[]
 * AddrInfo: string[], AddrInfo[]
 * RootInfo: no request data, AddrInfo
 */
export enum RequestType {
	//All endorsers for a badge(class)
	EndorsersBadge = "endorsersbadge",
	EndorsersBadgeClass = "endorsersbadgeclass",
	//All badge(classes) endorsed by someone
	EndorsedBadges = "endorsedbadges",
	EndorsedBadgeClasses = "endorsedbadgeclasses",
	//The badge(class)(endorsement) itsself
	Badge = "badge",
	BadgeClass = "badgeclass",
	EndorsementBadge = "endorsementbadge",
	EndorsementBadgeClass = "endorsementbadgeclass",
	//Other info
	BadgeClasses = "badgeclasses",
	Entities = "entities",
	Institution = "institution",
	Institutions = "institutions",
	AddrInfo = "addrinfo",
	RootInfo = "rootinfo",
	//Subscribe for push updates
	AllPush = "allpush"
}

export type RequestData = AddrInfoRequest | string;

export interface AddrInfoRequest {
	addresses: string[];
	revokedTime: number | null;
}

//Responses or pushes
export type ResponseData = AddrInfo[] | { [key: string]: number } | string | undefined;

export interface EndorsedBadge {
	id: number; //Id of endorsement
	badge: string; //Badge that is endorsed by entity
	issued_on: number;
	revoked: number | null;
	json: any;
}

export interface EndorsedBadgeClass {
	id: number; //Id of endorsement
	class: string; //Badge class that is endorsed by entity
	issued_on: number;
	revoked: number | null;
	json: any;
}

export interface EndorserBadge {
	id: number; //Id of endorsement
	entity: string; //Address of entity that endorses the badge
	issued_on: number;
	json: any;
}

export interface EndorserBadgeClass {
	id: number; //Id of endorsement
	entity: string; //Address of entity that endorses the badge class
	issued_on: number;
	revoked: number | null;
	json: any;
}

export interface AddrInfo {
	addr: string;
	names: Array<{
		name: string;
		startTime: number;
		endTime: number | null;
	}>;
	parent?: string;
	iri?: string;
	revokedTime: number | null;
	type: "entity" | "institution" | "processor";
}