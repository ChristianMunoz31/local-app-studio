import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitScale } from '../frame';
import ScaleToFit from '../ScaleToFit';

let callbacks: Array<() => void> = [];
class FakeResizeObserver {
  constructor(cb: () => void) {
    callbacks.push(cb);
  }
  observe(): void {}
  disconnect(): void {}
}

function sizes(box: [number, number], content: [number, number]): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(box[0]);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(box[1]);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(content[0]);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(content[1]);
}

beforeEach(() => {
  callbacks = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fitScale', () => {
  it('shrinks to the tighter side and never grows', () => {
    expect(fitScale(300, 170, 720, 200)).toBeCloseTo(300 / 720);
    expect(fitScale(300, 100, 300, 400)).toBeCloseTo(0.25);
    expect(fitScale(300, 170, 200, 80)).toBe(1);
    expect(fitScale(0, 0, 720, 200)).toBe(1);
  });
});

describe('ScaleToFit', () => {
  it('scales a wide table below 1 and hides overflow instead of adding scrollbars', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    sizes([300, 170], [720, 260]);
    render(
      <ScaleToFit designWidth={720}>
        <p>Table</p>
      </ScaleToFit>,
    );
    const content = screen.getByTestId('scale-content');
    expect(content.style.transform).toBe(`scale(${300 / 720})`);
    expect(content.style.transformOrigin).toBe('top left');
    expect(content.style.width).toBe('720px');
    const box = screen.getByTestId('scale-box');
    expect(box.className).toContain('overflow-hidden');
    expect(box.className).not.toMatch(/overflow-(auto|scroll)/);
    expect(content.hasAttribute('inert')).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps a small tile at full size and centers it', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    sizes([300, 170], [200, 80]);
    render(
      <ScaleToFit designWidth={200}>
        <p>Tile</p>
      </ScaleToFit>,
    );
    const content = screen.getByTestId('scale-content');
    expect(content.style.transform).toBe('scale(1)');
    expect(content.style.left).toBe('50px');
  });

  it('measures again when the box changes size', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    sizes([300, 170], [600, 100]);
    render(
      <ScaleToFit designWidth={600}>
        <p>x</p>
      </ScaleToFit>,
    );
    expect(screen.getByTestId('scale-content').style.transform).toBe('scale(0.5)');
    sizes([600, 170], [600, 100]);
    act(() => callbacks.forEach((cb) => cb()));
    expect(screen.getByTestId('scale-content').style.transform).toBe('scale(1)');
  });

  it('does not scale without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    sizes([300, 170], [720, 260]);
    render(
      <ScaleToFit designWidth={720}>
        <p>Table</p>
      </ScaleToFit>,
    );
    expect(screen.getByTestId('scale-content').style.transform).toBe('scale(1)');
  });
});
