import { Fragment, createElement, useMemo } from 'react';
import { parseMarkdown } from './markdownParse';

// The renderer behind ./Markdown: it turns the token tree from markdownParse into React elements. There is
// no raw HTML path (no dangerouslySetInnerHTML, no innerHTML); every string goes in as a React text child.
// Props match the old react-markdown surface the app used: `components` (per tag overrides),
// `disallowedElements` and `unwrapDisallowed`. Images render their alt text only, never an <img>.

const NO_COMPONENTS = {};

function overrideFor(ctx, tag) {
  const override = Object.prototype.hasOwnProperty.call(ctx.components, tag) ? ctx.components[tag] : null;
  return typeof override === 'function' || typeof override === 'string' ? override : null;
}

const hasOverride = (ctx, tag) => overrideFor(ctx, tag) !== null;

function makeElement(ctx, tag, key, props, children) {
  if (ctx.disallowed.has(tag)) return ctx.unwrap && children ? createElement(Fragment, { key }, children) : null;
  const type = overrideFor(ctx, tag) ?? tag;
  return createElement(type, children === undefined ? { key, ...props } : { key, ...props, children });
}

function renderInline(nodes, ctx, prefix) {
  return nodes.map((node, i) => {
    const key = `${prefix}.${i}`;
    switch (node.t) {
      case 'text':
        return node.v;
      case 'code':
        return makeElement(ctx, 'code', key, {}, node.v);
      case 'br':
        return makeElement(ctx, 'br', key, {});
      case 'strong':
      case 'em':
      case 'del':
        return makeElement(ctx, node.t, key, {}, renderInline(node.c, ctx, key));
      case 'a': {
        const kids = renderInline(node.c, ctx, key);
        // No safe href: the label is plain text, unless the caller overrides links (it then gets no href).
        if (node.href === null && !hasOverride(ctx, 'a')) return createElement(Fragment, { key }, kids);
        return makeElement(ctx, 'a', key, node.href === null ? {} : { href: node.href }, kids);
      }
      case 'img':
        return ctx.disallowed.has('img') ? null : node.alt;
      default:
        return null;
    }
  });
}

function renderCell(tag, cell, align, ctx, key) {
  return makeElement(ctx, tag, key, align ? { style: { textAlign: align } } : {}, renderInline(cell, ctx, key));
}

function renderItem(item, tight, ctx, key) {
  const kids = [];
  if (item.task !== null) {
    kids.push(makeElement(ctx, 'input', `${key}.cb`, { type: 'checkbox', checked: item.task, disabled: true }), ' ');
  }
  item.blocks.forEach((block, i) => {
    if (tight && block.t === 'p') {
      for (const part of renderInline(block.c, ctx, `${key}.${i}`)) kids.push(part);
    } else {
      kids.push(renderBlock(block, ctx, `${key}.${i}`));
    }
  });
  return makeElement(ctx, 'li', key, item.task !== null ? { className: 'task-list-item' } : {}, kids);
}

function renderBlocks(blocks, ctx, prefix) {
  return blocks.map((block, i) => renderBlock(block, ctx, `${prefix}${i}`));
}

function renderBlock(block, ctx, key) {
  switch (block.t) {
    case 'p':
      return makeElement(ctx, 'p', key, {}, renderInline(block.c, ctx, key));
    case 'h':
      return makeElement(ctx, `h${block.level}`, key, {}, renderInline(block.c, ctx, key));
    case 'hr':
      return makeElement(ctx, 'hr', key, {});
    case 'code': {
      const code = makeElement(ctx, 'code', `${key}.c`, block.lang ? { className: `language-${block.lang}` } : {}, `${block.text}\n`);
      return makeElement(ctx, 'pre', key, {}, [code]);
    }
    case 'quote':
      return makeElement(ctx, 'blockquote', key, {}, renderBlocks(block.c, ctx, `${key}.`));
    case 'list': {
      const hasTask = block.items.some((item) => item.task !== null);
      const props = {};
      if (block.ordered && block.start !== 1) props.start = block.start;
      if (hasTask) props.className = 'contains-task-list';
      const items = block.items.map((item, i) => renderItem(item, block.tight, ctx, `${key}.${i}`));
      return makeElement(ctx, block.ordered ? 'ol' : 'ul', key, props, items);
    }
    case 'table': {
      const head = block.head.map((cell, i) => renderCell('th', cell, block.aligns[i], ctx, `${key}.h${i}`));
      const headRow = makeElement(ctx, 'tr', `${key}.h`, {}, head);
      const parts = [makeElement(ctx, 'thead', `${key}.thead`, {}, [headRow])];
      if (block.rows.length) {
        const rows = block.rows.map((row, r) =>
          makeElement(
            ctx,
            'tr',
            `${key}.r${r}`,
            {},
            row.map((cell, c) => renderCell('td', cell, block.aligns[c], ctx, `${key}.r${r}.${c}`)),
          ),
        );
        parts.push(makeElement(ctx, 'tbody', `${key}.tbody`, {}, rows));
      }
      return makeElement(ctx, 'table', key, {}, parts);
    }
    default:
      return null;
  }
}

/**
 * Renders markdown text as React elements.
 * @param {{ children?: string, components?: object, disallowedElements?: string[], unwrapDisallowed?: boolean }} props
 */
export default function MarkdownImpl({ children, components, disallowedElements, unwrapDisallowed }) {
  const text = typeof children === 'string' ? children : '';
  const tree = useMemo(() => parseMarkdown(text), [text]);
  const ctx = {
    components: components && typeof components === 'object' ? components : NO_COMPONENTS,
    disallowed: new Set(Array.isArray(disallowedElements) ? disallowedElements : []),
    unwrap: Boolean(unwrapDisallowed),
  };
  return <>{renderBlocks(tree, ctx, 'b')}</>;
}
