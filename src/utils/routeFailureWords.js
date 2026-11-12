// The words of the kit-level route and section boundary (src/components/shared/RouteBoundary.jsx). They live here, in
// the initial chunk, because the boundary must be able to speak when the chunk that holds the rest of the copy
// (src/errors, src/studio) is the thing that failed to load.

export const ROUTE_FAILURE = {
  pageTitle: 'This page could not be shown',
  sectionTitle: 'This section could not be shown',
  renderSentence: 'Something went wrong while drawing this.',
  renderAction: 'Press Try again. If it keeps happening, reload the app.',
  chunkSentence: 'Part of the app could not be loaded.',
  chunkAction: 'Reload the app.',
  safe: 'Your saved work is safe.',
  tryAgain: 'Try again',
  reload: 'Reload',
  goHome: 'Go to the home page',
};

const CHUNK_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically imported/;

/** True when `error` is a failed lazy import (a chunk that did not load). */
export function isChunkFailure(error) {
  if (typeof error !== 'object' || error === null) return false;
  return error.name === 'ChunkLoadError' || (typeof error.message === 'string' && CHUNK_FAILURE.test(error.message));
}
