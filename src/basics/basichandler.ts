/**
 * @license
 * Copyright Coinversable B.V. All Rights Reserved.
 *
 * Use of this source code is governed by a AGPLv3-style license that can be
 * found in the LICENSE file at https://validana.io/license
 */

import { ActionHandler } from "../actionhandler";
import { addBasics } from "./addBasics";

/**
 * An example action handler.
 * We add the Basic functionality to this action handler and nothing else.
 * Of course we could have made this without using the addBasics function and just extend ActionHandler directly,
 * but this enables us to extend multiple reusable 'modules' and quickly build new action handlers.
 */
export default class BasicHandler extends addBasics(ActionHandler) { }