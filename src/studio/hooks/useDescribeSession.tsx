// The helper's run and its design, held by the workspace so moving between steps keeps them (DESIGN-phase12.md 2.1).
import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { diffSpecs } from '../lib/specDiff';
import { useDescribe } from './useDescribe';
import type { UseDescribe } from './useDescribe';
import { useStepChrome } from './useStepChrome';
import { useWorkspace } from './useWorkspace';

const DescribeSessionContext = createContext<UseDescribe | null>(null);

export const MADE_DESIGN = 'The helper made a design. Check it, then press Use this.';
export const REMOVES_DATA = ' Some changes remove data: read them first.';
export const DESIGN_READY = "The helper's design is ready. Open Prompt to check it.";
export const NO_CHANGES_SAID = 'The helper suggested no changes.';
export const DESIGN_FAILED = 'The helper could not make a design.';
export const DESIGN_REPLACED = 'The helper made a new design in place of the one that was waiting.';
export const DESIGN_CHANGED = 'The helper changed the waiting design.';
export const CHECK_IT = ' Check it, then press Use this.';

/** Must sit inside WorkspaceContext; announcements go through the nearest StepChromeContext. */
export function DescribeSessionProvider({ children }: { children: ReactNode }) {
  const { record, spec } = useWorkspace();
  const describe = useDescribe(record.id);
  const { announce } = useStepChrome();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  const specRef = useRef(spec);
  const phaseRef = useRef(describe.phase);
  useEffect(() => {
    pathRef.current = location.pathname;
    specRef.current = spec;
  });

  const { phase, proposal, error, landed } = describe;
  useEffect(() => {
    const before = phaseRef.current;
    phaseRef.current = phase;
    if (before === phase) return;
    const reason = (error?.message ?? '').replace(/\s+/g, ' ').trim();
    if (phase === 'proposal' && proposal !== null) {
      if (error !== null) {
        // A change that failed or was refused: the design is back, the reason is the one announcement.
        announce(reason === '' || reason.includes(DESIGN_FAILED) ? DESIGN_FAILED : `${DESIGN_FAILED} ${reason}`);
      } else if (before === 'running' && landed === null) {
        // A change that was stopped leaves the design as it was: nothing new to say.
      } else if (pathRef.current.endsWith('/prompt')) {
        // On Prompt the design shows beside the prompt and the pane takes focus; nowhere else does the step move. What happened to
        // a waiting design is said here, once, when the answer lands (not when the ask starts).
        const risky = diffSpecs(specRef.current, proposal).some((c) => c.destructive);
        const said = landed === 'refined' ? DESIGN_CHANGED + CHECK_IT : landed === 'replaced' ? DESIGN_REPLACED + CHECK_IT : MADE_DESIGN;
        announce(said + (risky ? REMOVES_DATA : ''));
      } else {
        announce(DESIGN_READY);
      }
    } else if (phase === 'unchanged') {
      announce(NO_CHANGES_SAID);
    } else if (phase === 'error') {
      // The pane shows the reason in a named region (not an alert), so the one announcement carries it.
      announce(reason === '' || reason.includes(DESIGN_FAILED) ? DESIGN_FAILED : `${DESIGN_FAILED} ${reason}`);
    }
  }, [phase, proposal, error, landed, announce]);

  return <DescribeSessionContext.Provider value={describe}>{children}</DescribeSessionContext.Provider>;
}

/** The session when there is one (a step shown outside the workspace shell has none), else null. */
// eslint-disable-next-line react-refresh/only-export-components -- the contract keeps the provider and its hooks in this one file
export function useOptionalDescribeSession(): UseDescribe | null {
  return useContext(DescribeSessionContext);
}

// eslint-disable-next-line react-refresh/only-export-components -- the contract keeps the provider and its hooks in this one file
export function useDescribeSession(): UseDescribe {
  const value = useContext(DescribeSessionContext);
  if (!value) throw new Error('useDescribeSession must be used inside DescribeSessionProvider.');
  return value;
}
