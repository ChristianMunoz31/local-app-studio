import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as z from 'zod'
import LayerRenderer from '@/vendor/ui-builder/components/ui/ui-builder/layer-renderer'
import UIBuilder from '@/vendor/ui-builder/components/ui/ui-builder'
import type { ComponentLayer, ComponentRegistry } from '@/vendor/ui-builder/components/ui/ui-builder/types'

const registry: ComponentRegistry = {
  Box: {
    component: ({ children }: { children?: React.ReactNode }) => <div data-testid="box">{children}</div>,
    schema: z.object({ children: z.any().optional() }),
    from: '@/test/box',
  },
}

const page: ComponentLayer = {
  id: 'root',
  type: 'Box',
  name: 'Root',
  props: {},
  children: [{ id: 'leaf', type: 'Box', name: 'Leaf', props: {}, children: 'hello vendored' }],
}

describe('vendored ui-builder', () => {
  it('loads the UIBuilder module', () => {
    expect(UIBuilder).toBeTruthy()
  })

  it('renders a two-node layout through LayerRenderer', () => {
    render(<LayerRenderer page={page} componentRegistry={registry} />)
    expect(screen.getByText('hello vendored')).toBeTruthy()
    expect(screen.getAllByTestId('box')).toHaveLength(2)
  })
})
