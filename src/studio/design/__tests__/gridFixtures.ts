// Fixtures and spies of the grid settings and key tests.
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { layer } from '@/catalog/__tests__/fixtures';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { TreeResult } from '../../lib/layoutTree';

export const at = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });
export const text = (id: string, grid?: GridPlace): LayoutLayer => ({ ...layer(id, 'Text', {}, id), ...(grid === undefined ? {} : { grid }) });
export const freeGrid = (id: string, children: LayoutLayer[], rows = 1): LayoutLayer => layer(id, 'Grid', { placement: 'free', columns: 12, rows }, children);
export const flowGrid = (id: string, children: LayoutLayer[]): LayoutLayer => layer(id, 'Grid', { columns: 2 }, children);
export const page = (...children: LayoutLayer[]): LayoutLayer => layer('root', 'Page', {}, children);

export interface Spies {
  announceGrid: Mock<(message: string, kind: string) => void>;
  tell: Mock<(message: string, undo?: boolean) => void>;
  focusBlock: Mock<(id: string) => void>;
  openSettings: Mock<(id: string | null, focus?: string) => void>;
  apply: Mock<(result: TreeResult) => void>;
}

export const makeSpies = (): Spies => ({
  announceGrid: vi.fn<(message: string, kind: string) => void>(),
  tell: vi.fn<(message: string, undo?: boolean) => void>(),
  focusBlock: vi.fn<(id: string) => void>(),
  openSettings: vi.fn<(id: string | null, focus?: string) => void>(),
  apply: vi.fn<(result: TreeResult) => void>(),
});
