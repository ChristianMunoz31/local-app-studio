// Client index of the error words. The server never imports this file: it loads copy.core.js
// directly and registers the Studio rows through server/modules/studio.js.

import { CORE_ERROR_COPY } from './copy.core.js';
import { STUDIO_ERROR_COPY } from './copy.studio.js';

/** @typedef {import('./copy.core.js').ErrorCopyRow} ErrorCopyRow */

/** Core rows plus Studio rows, frozen. @type {Readonly<Record<string, ErrorCopyRow>>} */
export const ERROR_COPY = Object.freeze({ ...CORE_ERROR_COPY, ...STUDIO_ERROR_COPY });

/** Every code that has a row, sorted. @type {readonly string[]} */
export const ERROR_CODES = Object.freeze(Object.keys(ERROR_COPY).sort());
