import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDocumentTitle } from '../useDocumentTitle';

afterEach(cleanup);

function Title({ text }: { text: string }) {
  useDocumentTitle(text);
  return null;
}

describe('useDocumentTitle', () => {
  it('sets the title, follows changes and restores the previous one on unmount', () => {
    document.title = 'Before';
    const { rerender, unmount } = render(<Title text="Design, Crew Roster, Local App Studio" />);
    expect(document.title).toBe('Design, Crew Roster, Local App Studio');
    rerender(<Title text="Data, Crew Roster, Local App Studio" />);
    expect(document.title).toBe('Data, Crew Roster, Local App Studio');
    unmount();
    expect(document.title).toBe('Before');
  });
});
