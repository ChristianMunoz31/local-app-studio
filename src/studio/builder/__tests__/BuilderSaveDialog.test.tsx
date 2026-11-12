import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { libraryOf } from '../../hooks/useFeatures';
import BuilderSaveDialog from '../BuilderSaveDialog';
import { layer } from './benchFixtures';

afterEach(cleanup);

describe('BuilderSaveDialog culprit (phase 17 round 2, S4)', () => {
  const doc = { root: layer('root_feature', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Hello')]), sources: [], tables: [] };
  const mount = (): void => {
    render(<BuilderSaveDialog editing={null} doc={doc} library={libraryOf(seedRecords())} state={{ textOn: new Set<string>(), labels: {} }} needsSlots={false} onSaved={() => {}} onCancel={() => {}} />);
  };

  it('clears the invalid mark and the message pointer of the name box when its text changes', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    const name = screen.getByLabelText('Name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).not.toBeNull();
    fireEvent.change(name, { target: { value: 'Crew list' } });
    expect(name.getAttribute('aria-invalid')).toBeNull();
    expect(name.getAttribute('aria-describedby')).toBeNull();
  });

  it('clears the line box the same way and leaves its hint', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew list' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    const line = screen.getByLabelText('What it is for, in one line');
    expect(line.getAttribute('aria-invalid')).toBe('true');
    expect(line.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    fireEvent.change(line, { target: { value: 'Shows crews.' } });
    expect(line.getAttribute('aria-invalid')).toBeNull();
    expect(line.getAttribute('aria-describedby')?.split(' ')).toHaveLength(1);
  });
});
