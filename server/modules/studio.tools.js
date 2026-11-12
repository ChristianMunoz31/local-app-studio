// The Studio Assistant's tools (read only in v1). Replaced by studio.tools.disabled.js in a runtime build
// (scripts/desktop/modeBuild.js), so nothing it imports ships in a built app. server/agents/assistantTools.js
// imports this seam, never server/studio/** directly.
import { listFeatureSummaries } from '../studio/features/store.js';

const tool = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
});

/** OpenAI-format specs of the Studio tools. Their cloud category is `features` (studio.data.js toolCategories). */
export const STUDIO_TOOLS = Object.freeze([
  tool(
    'list_features',
    "List the user's saved features (reusable groups of page parts): id, name, description, settings and how many apps use each. Read only.",
    { query: { type: 'string', description: 'Optional words to find in the name or description.' } },
  ),
]);

/**
 * Runs one Studio tool.
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<object>}
 */
export async function runStudioTool(name, args = {}) {
  switch (name) {
    case 'list_features': {
      const query = typeof args?.query === 'string' ? args.query.slice(0, 200) : undefined;
      return listFeatureSummaries({ query });
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
