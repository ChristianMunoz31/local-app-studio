// The Alt+Arrow keys of a part placed freely on a grid (docs/DESIGN.md "Parts placed freely on a grid", ADR-012).
import { useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { readGrid } from '@local-app-studio/runtime/spec/gridPlacement';
import type { GridDirection } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { isFreeGrid, placeOf, stepInGrid } from '../lib/gridLayout';
import { heightWords, movedWords, widthWords, withNarrow } from '../lib/gridWords';
import { blockName } from './designLabels';
import { useDesign } from './DesignContext';
import { narrowGrid } from './gridMetrics';
import { orderChanged, stepRefusal } from './gridSteps';

const KEY_DIRECTION: Readonly<Record<string, GridDirection>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const nameOf = (layer: LayoutLayer, parent: LayoutLayer | null): string => blockName(layer, parent);

/** The Alt+Arrow keys of a part placed freely on a grid. Returns a key handler that answers true when it handled the key. */
export function useGridKeys(layer: LayoutLayer, parent: LayoutLayer | null): (e: KeyboardEvent<HTMLElement>) => boolean {
  const { root, apply, focusBlock, announceGrid } = useDesign();
  return useCallback(
    (e) => {
      const dir = KEY_DIRECTION[e.key];
      if (dir === undefined || !e.altKey || e.ctrlKey || e.metaKey) return false;
      if (parent === null || !isFreeGrid(parent) || readGrid(layer.grid) === null) return false;
      // Always, so the browser's Alt+ArrowLeft Back never runs (also at an edge, on a refusal and when the key repeats).
      e.preventDefault();
      const mode = e.shiftKey ? 'resize' : 'move';
      const result = stepInGrid(root, layer.id, dir, mode);
      if (!result.ok) {
        announceGrid(stepRefusal(root, layer.id, dir, mode, nameOf) ?? result.message, 'refusal');
        return true;
      }
      const refusal = apply(result);
      if (refusal !== null) {
        announceGrid(refusal, 'refusal');
        return true;
      }
      const next = placeOf(result.root, layer.id);
      if (next === null) return true;
      const narrow = narrowGrid();
      let words: string;
      if (mode === 'move') words = movedWords(next);
      else words = dir === 'left' || dir === 'right' ? widthWords(next) : heightWords(next);
      words = withNarrow(words, narrow);
      // The canvas re-sorts the keyed wrappers whenever the order changes, at every width, so the focus is put back each time.
      if (orderChanged(root, result.root, layer.id)) {
        focusBlock(layer.id);
        announceGrid(words, 'quiet');
      } else {
        announceGrid(words, 'step');
      }
      return true;
    },
    [root, layer, parent, apply, focusBlock, announceGrid],
  );
}
