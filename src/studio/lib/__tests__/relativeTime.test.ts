import { describe, expect, it } from 'vitest';
import { relativeTimeLabel } from '../relativeTime';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);

describe('relativeTimeLabel', () => {
  it('uses the largest whole unit', () => {
    expect(relativeTimeLabel(ago(30), NOW)).toBe('just now');
    expect(relativeTimeLabel(ago(5 * 60), NOW)).toBe('5 minutes ago');
    expect(relativeTimeLabel(ago(2 * 3600), NOW)).toBe('2 hours ago');
    expect(relativeTimeLabel(ago(3 * 86400), NOW)).toBe('3 days ago');
    expect(relativeTimeLabel(ago(60 * 86400), NOW)).toBe('2 months ago');
    expect(relativeTimeLabel(ago(800 * 86400), NOW)).toBe('2 years ago');
  });

  it('reads a future time as "in ..."', () => {
    expect(relativeTimeLabel(new Date(NOW.getTime() + 2 * 3600 * 1000), NOW)).toBe('in 2 hours');
  });
});
