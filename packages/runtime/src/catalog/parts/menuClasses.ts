// The literal Tailwind class tables of the app menu bar (src/runtime/AppMenu.jsx). Pure strings so the runtime imports them
// without pulling zod or the editor, and so the theme audit can read every class. The first group is the bar of a spec with
// no menu slots, kept verbatim; the second is the bar with slots.

export const MENU_LINK =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';
export const MENU_CURRENT = 'bg-accent-indigo/15 text-accent-indigo';
export const MENU_OTHER = 'text-slate-slate300 hover:bg-slate-slate700/40 hover:text-slate-slate100';

export const TOP_NAV = 'overflow-x-auto border-b border-slate-slate700/60 p-2';
export const TOP_LIST = 'flex w-max min-w-full gap-1';
// The links of a bar that holds slots or a trail, and of the Design canvas bar: they wrap onto a second line instead of scrolling
// sideways, so every page link is always drawn, in the runtime and on the canvas alike. TOP_LIST stays for the plain bar.
export const TOP_LIST_WRAP = 'flex flex-wrap gap-1';
export const SIDE_FRAME = 'md:flex md:items-start';
export const SIDE_NAV = 'border-b border-slate-slate700/60 p-2 md:w-56 md:shrink-0 md:border-b-0 md:border-r md:self-stretch';
export const SIDE_LIST = 'flex flex-wrap gap-1 md:flex-col md:flex-nowrap';

// With slots: the top bar is a column (start, links, end stacked) below md and one line from md up.
export const TOP_BAR = 'flex flex-col gap-2 border-b border-slate-slate700/60 p-2 md:flex-row md:items-center';
export const TOP_NAV_IN_BAR = 'min-w-0 overflow-x-auto md:flex-1';
export const SLOT_CLASS = Object.freeze({
  start: 'flex flex-wrap items-center gap-2',
  end: 'flex flex-wrap items-center gap-2 md:ml-auto',
});
export const SIDE_RAIL = 'flex flex-col gap-2 border-b border-slate-slate700/60 p-2 md:w-56 md:shrink-0 md:border-b-0 md:border-r md:self-stretch';
export const SIDE_SLOT = 'flex flex-wrap items-center gap-2 md:flex-col md:items-stretch';

// The collapsed side menu (icons only). Every collapsed class is md: and up: below md the rail stacks above the page as
// before, the control is hidden there and a stored collapsed choice changes nothing.
export const SIDE_NAV_COLLAPSED = 'border-b border-slate-slate700/60 p-2 md:w-auto md:shrink-0 md:border-b-0 md:border-r md:self-stretch';
export const SIDE_RAIL_COLLAPSED = 'flex flex-col gap-2 border-b border-slate-slate700/60 p-2 md:w-auto md:shrink-0 md:border-b-0 md:border-r md:self-stretch';
export const SIDE_TOGGLE =
  'hidden md:mb-1 md:flex md:w-fit items-center gap-1.5 rounded-md p-1.5 text-xs font-medium text-slate-slate300 hover:bg-slate-slate700/40 hover:text-slate-slate100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2';
export const LINK_COLLAPSED = 'md:justify-center md:px-2';
export const LABEL_COLLAPSED = 'md:hidden';
export const LETTER_BADGE =
  'hidden size-6 items-center justify-center rounded-full bg-slate-slate700/40 text-xs font-semibold text-slate-slate100 md:inline-flex';
export const SLOT_COLLAPSED = 'md:hidden';

// The entry of a built app (Assistant and Settings, RuntimeEntry.jsx) and the way back from a kit page (RuntimeShell.jsx).
// TRAIL holds the two buttons; the bar variants only differ in where it sits.
export const TRAIL = 'flex items-center gap-1';
export const TRAIL_END = 'flex items-center gap-1 md:ml-auto';
export const TRAIL_FOLDED = 'flex items-center gap-1 md:flex-col';
export const TOP_BAR_TRAIL = 'flex items-center gap-2 border-b border-slate-slate700/60 p-2';
export const TOP_NAV_TRAIL = 'min-w-0 flex-1 overflow-x-auto';
// The corner pill of an app with no menu bar, and the padding that keeps the page's last line clear of it.
export const CORNER_PILL = 'fixed bottom-4 right-4 z-30 flex items-center gap-1 rounded-full glass p-1 shadow-lg';
export const CORNER_PAD = 'pb-16';
export const ENTRY_BUTTON =
  'inline-flex items-center justify-center rounded-md p-1.5 text-slate-slate300 hover:bg-slate-slate700/40 hover:text-slate-slate100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';
export const BACK_LINK =
  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-slate-slate300 hover:bg-slate-slate700/40 hover:text-slate-slate100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight';
