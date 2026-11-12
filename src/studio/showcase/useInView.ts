// True once the element has been within `margin` px of the viewport; stays true after. Without IntersectionObserver
// (old webviews, tests that do not mock it) the element counts as in view.
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useInView<T extends Element>(margin = 200): { ref: RefObject<T | null>; inView: boolean } {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (inView || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: `${margin}px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, margin]);

  return { ref, inView };
}
