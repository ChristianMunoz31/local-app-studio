// Test-only renderer. It reproduces the props contract of the removed vendored ui-builder LayerRenderer/RenderLayer (no
// editorConfig, no variables, no function registry) so registry.test.tsx and partsDom.test.tsx keep exercising parts the
// way the editor handed them props. partsDom.test.tsx is a security guard (hostile stored props must not reach the DOM),
// so the contract is kept exact:
// - the page renders inside a <div className>, one layer per registry entry, keyed by layer id;
// - props are copied from layer.props with nested plain objects rebuilt key by key (arrays and elements kept), a
//   { __variableRef } value becomes undefined (no variables), and keys starting with __function_ are dropped;
// - the component gets data-testid and data-layer-id first, then the spread props (so props can override them), and
//   `children`: child elements when the layer has a non-empty children list, else the string when children is a string;
//   an empty list adds no children prop;
// - an entry without `from` renders as the DOM tag named by the layer type, with id, data-testid and data-layer-id;
// - a component is wrapped in an error boundary and Suspense (fallback text "Loading...");
// - an unknown layer type logs a console error and renders nothing.
import React, { Component, Suspense, isValidElement, type ReactNode } from 'react';
import type { ComponentLayer, ComponentRegistry } from '../registryTypes.ts';

const isVariableReference = (value: unknown): boolean => typeof value === 'object' && value !== null && '__variableRef' in value;

function resolveProps(props: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('__function_')) continue;
    if (isVariableReference(value)) resolved[key] = undefined;
    else if (typeof value === 'object' && value !== null && !Array.isArray(value) && !isValidElement(value)) {
      resolved[key] = resolveProps(value as Record<string, unknown>);
    } else resolved[key] = value;
  }
  return resolved;
}

class LayerErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): ReactNode {
    return this.state.failed ? <div>Component Error</div> : this.props.children;
  }
}

function RenderLayer({ layer, componentRegistry }: { layer: ComponentLayer; componentRegistry: ComponentRegistry }): React.JSX.Element | null {
  const definition = componentRegistry[layer.type];
  if (!definition) {
    console.error('[UIBuilder] Component definition not found in registry:', { layerType: layer.type, layerId: layer.id });
    return null;
  }
  const props = resolveProps(layer.props);
  if (Array.isArray(layer.children) && layer.children.length > 0) {
    props.children = layer.children.map((child) => <RenderLayer key={child.id} layer={child} componentRegistry={componentRegistry} />);
  } else if (typeof layer.children === 'string') {
    props.children = layer.children;
  }
  if (definition.from === undefined || definition.from === null) {
    const Tag = layer.type as unknown as React.ElementType;
    return <Tag id={layer.id} data-testid={layer.id} data-layer-id={layer.id} {...props} />;
  }
  const Part = definition.component as React.ElementType;
  return (
    <LayerErrorBoundary key={layer.id}>
      <Suspense fallback={<div>Loading...</div>}>
        <Part data-testid={layer.id} data-layer-id={layer.id} {...props} />
      </Suspense>
    </LayerErrorBoundary>
  );
}

export default function LayerRenderer({
  className,
  page,
  componentRegistry,
}: {
  className?: string;
  page: ComponentLayer;
  componentRegistry: ComponentRegistry;
}): React.JSX.Element {
  return (
    <div className={className}>
      <RenderLayer layer={page} componentRegistry={componentRegistry} />
    </div>
  );
}
