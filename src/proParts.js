// Which pro parts this build contains (docs/ARCHITECTURE.md, 'The pro seam'). This is the public stub: every part is off.
// A pro build swaps this file for pro/src/proParts.js, where every part is on. Read it through server/buildFeatures.js
// on the server and directly in the Studio.
/** @type {{ readonly helper: boolean, readonly installer: boolean, readonly licensing: boolean, readonly cloud: boolean }} */
export const PRO_PARTS = Object.freeze({ helper: false, installer: false, licensing: false, cloud: false });
