/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { Log, start, Config, Crypto } from "validana-server";

//Add new keys to the config
export interface ExtraConfig {
	VSERVER_ADDR: string;
	VSERVER_NAME: string;
}
Config.addStringConfig<ExtraConfig>("VSERVER_NAME", "Surf");
Config.addStringConfig<ExtraConfig>("VSERVER_ADDR", undefined, (input) => {
	if (input === undefined) {
		throw new Error("No address given.");
	}
	const decodedAddress = Crypto.base58ToBinary(input);
	const checksum = decodedAddress.slice(-4);
	if (decodedAddress[0] !== 0x00 || !Crypto.hash256(decodedAddress.slice(0, -4)).slice(0, 4).equals(checksum)) {
		throw new Error("Invalid address.");
	}
});

//Set the log version
Log.options.tags!.version = "1.0.0";

//Start the program
start();