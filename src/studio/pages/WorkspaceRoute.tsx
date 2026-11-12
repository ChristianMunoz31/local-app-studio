// The /apps/:appId/* route: the workspace inside its error boundary (DESIGN-phase15.md 7.1).
import WorkspaceBoundary from '../errors/WorkspaceBoundary';
import AppWorkspace from './AppWorkspace';

export default function WorkspaceRoute() {
  return (
    <WorkspaceBoundary>
      <AppWorkspace />
    </WorkspaceBoundary>
  );
}
