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
 * BadgeClassInfo: string[], BadgeClass[]
 * Entities: string, string[]
 * Institution: string, string | undefined
 * Institutions: no request data, string[]
 * AddrInfo: string[], AddrInfo[]
 * RootInfo: no request data, AddrInfo
 */
export enum RequestType {
	BadgeClasses = "badgeClasses",
	EndorsersBadge = "endorsersBadge",
	EndorsersBadgeClass = "endorsersBadgeClass",
	EndorsedBadges = "endorsedBadges",
	EndorsedBadgeClasses = "endorsedBadgeClasses",
	BadgeClassInfo = "badgeClassInfo",
	Entities = "entities",
	Institution = "institution",
	Institutions = "institutions",
	AddrInfo = "addrInfo",
	RootInfo = "rootInfo"
}

export type RequestData = AddrInfoRequest | string;

export interface AddrInfoRequest {
	addresses: string[];
	withdrawn: boolean;
}

//Responses or pushes
export type ResponseData = BadgeClass[] | AddrInfo[] | string[] | string | undefined;

export interface BadgeClass {
	badgeClass: string;
	firstEndorser: string;
	metadata: object;
}

export interface AddrInfo {
	addr: string;
	name: string;
	parent?: string;
	withdrawn: boolean;
	type: "entity" | "institution" | "processor";
}