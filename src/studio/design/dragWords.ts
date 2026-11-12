// What the screen reader hears while a part is dragged on the Design canvas (DESIGN-phase13.md 3.9.5). dnd-kit's own
// announcements read ids ("Draggable item palette:part:DataTable was dropped over droppable area zone:root_home:1"); these say the
// part and the place in plain words. Pure: the session says which label and place an id means. The DndContext wiring is in
// DesignSession.tsx.

/** Where a part would go: a place in a container ("Page, place 2") or beside another part ("Table of records"). */
export interface DragPlace {
  kind: 'zone' | 'side';
  name: string;
}

/** "at Page, place 2", "beside Table of records". */
export function placeWords(place: DragPlace): string {
  return place.kind === 'zone' ? `at ${place.name}` : `beside ${place.name}`;
}

export const DRAG_WORDS = {
  start: (label: string): string => `Picked up ${label}.`,
  over: (label: string, place: DragPlace | null): string => (place === null ? `${label} is not over a place.` : `${label} is ${placeWords(place)}.`),
  end: (label: string, place: DragPlace | null): string => (place === null ? `${label} was not dropped.` : `Dropped ${label} ${placeWords(place)}.`),
  cancel: (label: string): string => `Stopped moving ${label}.`,
} as const;

export const DRAG_INSTRUCTIONS = 'To move a part with the keyboard, select it and use Move to... in its toolbar.';

/** The pieces of a dnd-kit event the words need (an Active or an Over has an id). */
interface Ref {
  id: string | number;
}

/**
 * The `announcements` for DndContext. `label` names the dragged part (a palette entry name, or the name of the block moved);
 * `place` names the place the pointer is over, or null when that is not a place.
 */
export function dragAnnouncements<A extends Ref, O extends Ref>(describe: { label(active: A): string; place(over: O): DragPlace | null }) {
  return {
    onDragStart: ({ active }: { active: A }): string => DRAG_WORDS.start(describe.label(active)),
    onDragOver: ({ active, over }: { active: A; over: O | null }): string => DRAG_WORDS.over(describe.label(active), over === null ? null : describe.place(over)),
    onDragEnd: ({ active, over }: { active: A; over: O | null }): string => DRAG_WORDS.end(describe.label(active), over === null ? null : describe.place(over)),
    onDragCancel: ({ active }: { active: A }): string => DRAG_WORDS.cancel(describe.label(active)),
  };
}
