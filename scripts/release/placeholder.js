// Detects the unrenamed kit template in a release repo. Dependency-free and side-effect-free so the UI bundle can import
// it without pulling in config/release.json.
//
// The owner handle is assembled from parts on purpose. `npm run init-app` rewrites the bare kit owner token everywhere in
// the tree, so a plain string literal here would become the buyer's owner and every renamed app would then look
// "not set up". Do not inline it, and do not spell the handle out in this file's comments either.
export const PLACEHOLDER_REPO_OWNER = ['your', 'github', 'user'].join('-');

// Same reason for the kit's product name: init-app rewrites the kit's product name to the buyer's name wherever it appears as text, which would make
// the un-renamed-build warning fire on every renamed app. Do not inline it.
export const PLACEHOLDER_PRODUCT_NAME = ['Starter', 'App'].join(' ');

/**
 * True while an "owner/name" repo still has the placeholder owner from the kit template (case-insensitive).
 * @param {unknown} repo
 * @returns {boolean}
 */
export const isPlaceholderRepo = (repo) =>
  typeof repo === 'string' && repo.split('/')[0].toLowerCase() === PLACEHOLDER_REPO_OWNER;
