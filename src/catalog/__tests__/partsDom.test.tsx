// Parts never forward unknown props to the DOM: a stored layout is data, so props like dangerouslySetInnerHTML, on*
// handlers, href, style or a class name must not reach the markup. Only the editor's own props pass.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LayerRenderer from '@/vendor/ui-builder/components/ui/ui-builder/layer-renderer';
import type { ComponentLayer } from '@/vendor/ui-builder/components/ui/ui-builder/types';
import { CatalogDataContext } from '../context.tsx';
import { editorDomProps } from '@local-app-studio/runtime/catalog/parts/editorProps.ts';
import { buildRegistry } from '../registry.tsx';
import { SPIKE_PART_CONTEXT } from '../types.ts';

afterEach(cleanup);
const registry = buildRegistry(SPIKE_PART_CONTEXT);

const hostile = (): ComponentLayer['props'] => ({
  dangerouslySetInnerHTML: { __html: '<form action="https://evil.example"><input name="pw"></form>' },
  onClick: 'alert(1)',
  onMouseEnter: 'alert(2)',
  className: 'evil-class fixed inset-0',
  style: { position: 'fixed' },
  href: 'https://evil.example',
  src: 'https://evil.example/x.png',
  id: 'hijacked',
});

const ALL_PARTS: Array<[string, ComponentLayer['children']]> = [
  ['Page', []],
  ['Section', []],
  ['Grid', []],
  ['Card', []],
  ['Tabs', []],
  ['Tab', []],
  ['Heading', 'Title'],
  ['Text', 'Body'],
  ['Divider', []],
  ['DataTable', []],
  ['RecordForm', []],
  ['RecordDetail', []],
  ['StatCard', []],
  ['RecordList', []],
  ['FilterBar', []],
  ['SearchBox', []],
  ['ReferencePicker', []],
  ['Button', 'Go'],
  ['Link', 'Home'],
  ['Columns', []],
  ['Column', []],
  ['Row', []],
  ['NavLinks', []],
  ['Breadcrumb', []],
  ['BackLink', 'Back'],
  ['PageHeader', []],
  ['Callout', 'Note'],
  ['Collapsible', []],
  ['Chart', []],
  ['ProgressBar', []],
  ['Timeline', []],
  ['Checklist', []],
  ['SortControl', []],
  ['QuickAdd', []],
];

describe('catalog parts and unknown props', () => {
  it.each(ALL_PARTS)('%s drops injected HTML, handlers, class names and attributes from layer props', (type, children) => {
    const page: ComponentLayer = { id: 'p', type, props: hostile(), children };
    const { container } = render(
      <CatalogDataContext.Provider value={{ apiBase: '/api' }}>
        <LayerRenderer page={page} componentRegistry={registry} />
      </CatalogDataContext.Provider>,
    );
    expect(container.querySelector('form')).toBeNull();
        expect(container.innerHTML).not.toContain('evil');
    expect(container.innerHTML).not.toContain('hijacked');
    expect(container.innerHTML).not.toContain('alert(');
    expect(container.querySelector('[href], [src], [style], [onclick], [onmouseenter]')).toBeNull();
    // The search box is the one part that renders an input of its own, with no value from the layer.
    expect(container.querySelector('input[name="pw"]')).toBeNull();
    expect(container.querySelector('[data-layer-id="p"]')).not.toBeNull();
  });

  it('still passes the editor data attributes', () => {
    const page: ComponentLayer = { id: 'root', type: 'Page', props: {}, children: [{ id: 'h', type: 'Heading', props: {}, children: 'Hi' }] };
    const { getByTestId } = render(<LayerRenderer page={page} componentRegistry={registry} />);
    expect(getByTestId('h').getAttribute('data-layer-id')).toBe('h');
  });
});

describe('editorDomProps', () => {
  it('keeps only the data attributes and the editor-added "relative" class', () => {
    const input = { 'data-testid': 'a', 'data-layer-id': 'a', className: 'evil relative p-0', dangerouslySetInnerHTML: { __html: 'x' }, onClick: () => {} };
    expect(editorDomProps(input)).toEqual({ 'data-testid': 'a', 'data-layer-id': 'a', className: 'relative' });
    expect(editorDomProps({ className: 'evil' })).toEqual({});
    expect(editorDomProps({ 'data-testid': 5 as unknown as string })).toEqual({});
  });
});
