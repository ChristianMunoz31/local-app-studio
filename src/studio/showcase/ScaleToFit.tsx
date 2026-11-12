// Draws its children at a fixed design width and shrinks them to fit the box around them, so a wide table and a small
// number tile both show whole, without scrollbars. Without ResizeObserver (tests) nothing is scaled.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fitScale } from './frame';

export interface ScaleToFitProps {
  designWidth: number;
  children: ReactNode;
}

interface Fit {
  scale: number;
  left: number;
}

const FULL: Fit = { scale: 1, left: 0 };

export default function ScaleToFit({ designWidth, children }: ScaleToFitProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>(FULL);

  useEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => {
      const w = Math.max(designWidth, inner.scrollWidth);
      const scale = fitScale(box.clientWidth, box.clientHeight, w, inner.scrollHeight);
      const left = Math.max(0, (box.clientWidth - w * scale) / 2);
      setFit((prev) => (prev.scale === scale && prev.left === left ? prev : { scale, left }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [designWidth]);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden" data-testid="scale-box">
      <div
        ref={innerRef}
        inert
        aria-hidden="true"
        className="pointer-events-none absolute top-0"
        data-testid="scale-content"
        style={{ width: designWidth, left: fit.left, transformOrigin: 'top left', transform: `scale(${fit.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
