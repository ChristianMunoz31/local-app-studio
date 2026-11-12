/**
 * Page-advice context for Home: the names of the sections the page links to. No user data.
 * @param {{ sections?: string[] }} input
 */
export function buildHomeContext({ sections } = {}) {
  return { sections: Array.isArray(sections) ? sections.filter((s) => typeof s === 'string') : [] };
}
