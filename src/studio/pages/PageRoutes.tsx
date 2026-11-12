// Puts a Studio page inside the page error boundary. studio.jsx loads a page and this wrapper together, so each page stays its
// own lazy chunk and nothing here reaches the initial chunk.
import type { ComponentType } from 'react';
import WorkspaceBoundary from '../errors/WorkspaceBoundary';

export function withPageBoundary(Page: ComponentType): ComponentType {
  function BoundedPage() {
    return (
      <WorkspaceBoundary variant="page">
        <Page />
      </WorkspaceBoundary>
    );
  }
  BoundedPage.displayName = `Bounded(${Page.displayName ?? Page.name})`;
  return BoundedPage;
}
