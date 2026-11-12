import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import SegmentedRadio from '../SegmentedRadio';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function setup(props = {}) {
  return render(
    <SegmentedRadio legend="Pick one" name="grp" value="b" onChange={() => {}} options={OPTIONS} {...props} />,
  );
}

describe('SegmentedRadio', () => {
  it('shows exactly one aria-hidden check indicator, inside the selected option', () => {
    const { container } = setup();
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(1);
    const label = icons[0].closest('label');
    expect(label).toContainElement(screen.getByRole('radio', { name: 'Beta' }));
  });

  it('moves the indicator when the value changes', () => {
    const { container, rerender } = setup();
    rerender(
      <SegmentedRadio legend="Pick one" name="grp" value="c" onChange={() => {}} options={OPTIONS} />,
    );
    const icons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(1);
    expect(icons[0].closest('label')).toContainElement(screen.getByRole('radio', { name: 'Gamma' }));
  });

  it('shows no indicator when no option is selected', () => {
    const { container } = setup({ value: 'zzz' });
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });

  it('keeps accessible names equal to the option labels (indicator adds nothing)', () => {
    setup();
    for (const { label } of OPTIONS) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: 'Beta' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'Pick one' })).toBeInTheDocument();
  });

  it('calls onChange with the clicked option value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    setup({ onChange });
    await user.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
