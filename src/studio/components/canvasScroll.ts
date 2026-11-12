// Scroll positions inside a DOM subtree that is about to be moved: a browser resets them when a node is re-attached.
export interface ScrollMark {
  el: Element;
  top: number;
  left: number;
}

/** The root and every descendant that is scrolled away from the start. */
export function saveScroll(root: Element): ScrollMark[] {
  const marks: ScrollMark[] = [];
  const note = (el: Element): void => {
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) marks.push({ el, top: el.scrollTop, left: el.scrollLeft });
  };
  note(root);
  root.querySelectorAll('*').forEach(note);
  return marks;
}

/** Puts the saved positions back. */
export function restoreScroll(marks: readonly ScrollMark[]): void {
  for (const mark of marks) {
    mark.el.scrollTop = mark.top;
    mark.el.scrollLeft = mark.left;
  }
}
