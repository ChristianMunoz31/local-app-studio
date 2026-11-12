// What a Button does as Design offers it: goes to a page, or opens a form to add a record (lib/actionKind.ts).
import { describe, expect, it } from 'vitest';
import { crewCtx, homeCtx, layer } from '@/catalog/__tests__/fixtures';
import { checkLayer, menuPartContext } from '@/catalog/validateLayout';
import { exampleSpec } from '@/catalog/__tests__/fixtures';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { BUTTON_KIND_LABELS, buttonKindOf, setButtonAction } from '../actionKind';
import { findLayer } from '../layoutTree';

const goHome = (id = 'b1'): LayoutLayer => layer(id, 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go');
const openForm = (id = 'b2'): LayoutLayer => layer(id, 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } }, 'New');
const tree = (): LayoutLayer => layer('root', 'Page', {}, [goHome(), openForm(), layer('b3', 'Button', { action: { action: 'delete-record', table: 'crews' } }, 'Delete'), layer('t1', 'Text', {}, 'x')]);

describe('buttonKindOf', () => {
  it('names the two choices and nothing else', () => {
    expect(buttonKindOf(goHome())).toBe('navigate');
    expect(buttonKindOf(openForm())).toBe('open-form');
    expect(buttonKindOf(layer('b', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'edit' } }, 'Edit'))).toBeNull();
    expect(buttonKindOf(layer('b', 'Button', { action: { action: 'delete-record', table: 'crews' } }, 'Delete'))).toBeNull();
    expect(buttonKindOf(layer('t', 'Text', {}, 'x'))).toBeNull();
    expect(buttonKindOf({ ...goHome(), feature: { id: 'f', version: 1, params: {} } })).toBeNull();
    expect(buttonKindOf(layer('b', 'Button', {}, 'No action'))).toBeNull();
  });

  it('has plain words for both', () => {
    expect(BUTTON_KIND_LABELS).toEqual({ navigate: 'Goes to a page', 'open-form': 'Opens a form to add a record' });
  });
});

describe('setButtonAction', () => {
  it('turns a page button into one that opens a form in the first table, and back', () => {
    const root = tree();
    const before = JSON.stringify(root);
    const toForm = setButtonAction(root, 'b1', 'open-form', homeCtx());
    expect(toForm.ok).toBe(true);
    if (!toForm.ok) return;
    expect(findLayer(toForm.root, 'b1')!.layer.props.action).toEqual({ action: 'open-form', table: homeCtx().tableIds[0], mode: 'create' });
    expect(findLayer(toForm.root, 'b1')!.layer.children).toBe('Go');
    expect(JSON.stringify(root)).toBe(before);
    const back = setButtonAction(toForm.root, 'b1', 'navigate', homeCtx());
    expect(back.ok && findLayer(back.root, 'b1')!.layer.props.action).toEqual({ action: 'navigate', pageId: 'home', withRecord: false });
  });

  it('takes the default words for a form while the text is "Button", and gives them back; typed words stay', () => {
    const tables = [{ id: homeCtx().tableIds[0]!, label: 'Crews', titleField: 'name', fields: [] }];
    const root = layer('root', 'Page', {}, [{ ...goHome('d'), children: 'Button' }, goHome('t')]);
    const toForm = setButtonAction(root, 'd', 'open-form', homeCtx(), tables);
    expect(toForm.ok && findLayer(toForm.root, 'd')!.layer.children).toBe('Add to Crews');
    if (!toForm.ok) return;
    const back = setButtonAction(toForm.root, 'd', 'navigate', homeCtx(), tables);
    expect(back.ok && findLayer(back.root, 'd')!.layer.children).toBe('Button');
    const typed = setButtonAction(root, 't', 'open-form', homeCtx(), tables);
    expect(typed.ok && findLayer(typed.root, 't')!.layer.children).toBe('Go');
  });

  it('makes a button that validates in the page and in the menu bar', () => {
    const spec = exampleSpec();
    for (const [ctx, place] of [[crewCtx(), 'page'], [menuPartContext(spec), 'menu']] as const) {
      const r = setButtonAction(tree(), 'b1', 'open-form', ctx);
      expect(r.ok).toBe(true);
      if (r.ok) expect(checkLayer(findLayer(r.root, 'b1')!.layer, ctx, 'layer', 5, place)).toEqual([]);
    }
  });

  it('is ok with the same root when the kind is already that one (no Undo step)', () => {
    const root = tree();
    const same = setButtonAction(root, 'b2', 'open-form', homeCtx());
    expect(same).toMatchObject({ ok: true, focusId: 'b2' });
    expect(same.ok && same.root).toBe(root);
  });

  it('refuses in plain words with no table, no page, a button that does something else, and a part that is not a button', () => {
    const noTable = { ...homeCtx(), tableIds: [] };
    expect(setButtonAction(tree(), 'b1', 'open-form', noTable)).toMatchObject({ ok: false, message: 'This app has no table yet. Put a part that shows records on a page and press New table on it.' });
    const noPage = { ...homeCtx(), pageIds: [], recordPageIds: [] };
    expect(setButtonAction(tree(), 'b2', 'navigate', noPage)).toMatchObject({ ok: false });
    expect(setButtonAction(tree(), 't1', 'navigate', homeCtx())).toMatchObject({ ok: false, message: 'Only a button has something to do.' });
    expect(setButtonAction(tree(), 'nope', 'navigate', homeCtx())).toMatchObject({ ok: false });
  });
});
