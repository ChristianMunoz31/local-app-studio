// Stub for server/modules/studio.tools.js in a runtime build: the Studio module offers no tools.
/** @type {ReadonlyArray<object>} */
export const STUDIO_TOOLS = Object.freeze([]);

/**
 * @param {string} name
 * @returns {Promise<{ error: string }>}
 */
export async function runStudioTool(name) {
  return { error: `Unknown tool: ${name}` };
}
