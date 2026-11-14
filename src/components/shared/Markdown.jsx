import { Suspense, lazy } from 'react';

const MarkdownImpl = lazy(() => import('./MarkdownImpl'));

/**
 * Safe GFM markdown renderer (no raw HTML, links limited to http, https and mailto) whose parser loads
 * on first use. Props other than `children` go to the renderer (`components`, `disallowedElements`,
 * `unwrapDisallowed`). While the
 * chunk loads the raw text shows (hidden from assistive tech, so the rendered result is
 * announced once), which keeps the block's height close to the final one.
 * @param {{ children: string, components?: object, disallowedElements?: string[], unwrapDisallowed?: boolean }} props
 */
export default function Markdown({ children, ...props }) {
  return (
    <Suspense
      fallback={
        <p aria-hidden="true" className="whitespace-pre-wrap">
          {children}
        </p>
      }
    >
      <MarkdownImpl {...props}>{children}</MarkdownImpl>
    </Suspense>
  );
}
