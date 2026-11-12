// Web build stub for mdast-util-gfm 3.1.0 (see index.js). `gfmFromMarkdown` is the real list, so tables, autolinks, strikethrough, footnotes and
// task lists still parse. `gfmToMarkdown` has no extensions: react-markdown only parses, and the real one pulls mdast-util-to-markdown and the
// five ToMarkdown factories into the Markdown chunk.
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';

export function gfmFromMarkdown() {
  return [
    gfmAutolinkLiteralFromMarkdown(),
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  ];
}

export function gfmToMarkdown() {
  return { extensions: [] };
}
