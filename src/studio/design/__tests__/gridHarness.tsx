// A small stateful Design context for the grid settings and key tests: the root lives in state, apply keeps a successful result,
// and the speech, status and focus callbacks are spies.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { exampleCtx, exampleSpec } from '@/catalog/__tests__/fixtures';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { libraryOf } from '../../hooks/useFeatures';
import type { TreeResult } from '../../lib/layoutTree';
import BlockSettings from '../BlockSettings';
import { DesignContext, useDesign } from '../DesignContext';
import { findLayer } from '../../lib/layoutTree';
import type { Spies } from './gridFixtures';
import type { DesignContextValue } from '../DesignContext';

/** `onRoot` hears every root a successful apply produces. */
export function Harness({ initial, spies, onRoot, children }: { initial: LayoutLayer; spies: Spies; onRoot?: (root: LayoutLayer) => void; children: ReactNode }) {
  const [root, setRoot] = useState(initial);
  const spec = AppSpecSchema.parse(exampleSpec(root));
  const value = {
    tree: 'page',
    menu: null,
    menuPosition: 'top',
    root,
    spec,
    page: spec.pages[1],
    ctx: exampleCtx(),
    library: libraryOf([]),
    settingsFocus: null,
    drag: null,
    selectedId: null,
    apply: (result: TreeResult): string | null => {
      spies.apply(result);
      if (!result.ok) return result.message;
      onRoot?.(result.root);
      setRoot(result.root);
      return null;
    },
    announceGrid: spies.announceGrid,
    tell: spies.tell,
    focusBlock: spies.focusBlock,
    openSettings: spies.openSettings,
    askTable: vi.fn(),
  } as unknown as DesignContextValue;
  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}

/** BlockSettings of the layer with this id, read from the current root like CanvasBlock does. */
export function LiveSettings({ id, onClose }: { id: string; onClose(): void }) {
  const { root } = useDesign();
  const found = findLayer(root, id);
  return found === null ? null : <BlockSettings layer={found.layer} onClose={onClose} />;
}
