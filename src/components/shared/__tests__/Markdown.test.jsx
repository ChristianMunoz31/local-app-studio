import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Markdown from '../Markdown';

afterEach(cleanup);

describe('Markdown (lazy)', () => {
  it('shows the raw text, hidden from assistive tech, until the parser chunk loads, then renders GFM', async () => {
    const { container } = render(<Markdown>{'**bold** and\n\n| a | b |\n| - | - |\n| 1 | 2 |'}</Markdown>);
    expect(container.querySelector('p[aria-hidden="true"]')).toHaveTextContent('**bold**');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('p[aria-hidden="true"]')).toBeNull();
  });

  it('passes disallowedElements and components through to react-markdown', async () => {
    const { container } = render(
      <Markdown disallowedElements={['img']} unwrapDisallowed components={{ a: ({ children }) => <b data-x="1">{children}</b> }}>
        {'![alt text](http://x.test/i.png) [link](http://x.test)'}
      </Markdown>,
    );
    expect(await screen.findByText('link')).toHaveAttribute('data-x', '1');
    expect(container.querySelector('img')).toBeNull();
  });
});
