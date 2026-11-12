// The app menu bar on the Design canvas: above the page (across the top) or beside it (down the side), in the app's own look, inside
// the same theme scope as the page. Its two sides (left and right across the top, top and bottom down the side) are drop boxes for the small parts a menu may hold (MENU_PARTS); the
// page links in between are a picture. The blocks, drop zones and settings in the bar are the page's own (CanvasBlock, DropZone,
// BlockSettings) read through the menu scope (`useDesign().menu`), so Settings, Move up and down, Delete, Undo and the keyboard work
// there unchanged. `renderNode` draws one layer; it is a prop so this file does not import DesignCanvas.
import { useDroppable } from '@dnd-kit/core';
import { PanelLeftClose } from 'lucide-react';
import type { ReactNode } from 'react';
import { MENU_CURRENT, MENU_LINK, MENU_OTHER, SIDE_FRAME, SIDE_LIST, SIDE_RAIL, SIDE_SLOT, SIDE_TOGGLE, SLOT_CLASS, TOP_BAR, TOP_LIST_WRAP, TOP_NAV_IN_BAR } from '@local-app-studio/runtime/catalog/parts/menuClasses';
import { menuEntries, menuLook, navIcon } from '@local-app-studio/runtime/catalog/parts/navItems';
import { MENU_PARTS } from '@local-app-studio/runtime/spec/menuSlots';
import type { MenuSlotName } from '@local-app-studio/runtime/spec/menuSlots';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { plainMessage } from '../lib/issueWords';
import { MENU_SLOT_IDS } from '../lib/menuTree';
import { menuSideName } from './designLabels';
import { DesignContext, useDesign } from './DesignContext';
import DropZone from './DropZone';

export type RenderNode = (layer: LayoutLayer, parent: LayoutLayer, index: number, count: number) => ReactNode;

const FITS = 'Fits here: Button, Link, Search box, Quick add, Text, Row';
export const EMPTY_SLOT_HINT = 'You can put a button or a search box here.';
const FULL = 'This side of the menu bar is full.';
const NOTE = 'text-xs text-slate-slate400';
const SLOT_BOX = 'min-w-40 rounded-md border border-dashed border-slate-slate700';

/** Why a drag has no place on this side: its own reason when it has one, "full" only when the part fits the bar and the count check failed. */
function refusalText(drag: NonNullable<ReturnType<typeof useDesign>['drag']>): string {
  if (!MENU_PARTS.includes(drag.type)) return FITS;
  return drag.refusal ? plainMessage(drag.refusal) : FULL;
}

/** While a part the slot does not take is dragged: the slot says what fits, and a drop on it answers with the reason in the status line. */
function RefuseBox({ slotId, text }: { slotId: string; text: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `refuse:${slotId}`, data: { kind: 'refuse', tree: 'menu', parentId: slotId } });
  return (
    <div ref={setNodeRef} className={`rounded-md border-2 border-dashed px-3 py-2 text-xs text-slate-slate300 ${isOver ? 'border-slate-brand' : 'border-slate-slate600'}`}>
      {text}
    </div>
  );
}

function Slot({ name, renderNode }: { name: MenuSlotName; renderNode: RenderNode }) {
  const { root, drag, zones, menuPosition } = useDesign();
  const holder = (root.children as LayoutLayer[]).find((s) => s.id === MENU_SLOT_IDS[name]);
  if (holder === undefined) return null;
  const kids = Array.isArray(holder.children) ? holder.children : [];
  const side = menuPosition === 'side';
  const prefix = `${holder.id}:`;
  const movingHere = drag !== null && drag.movingId !== null && drag.tree === 'menu' && kids.some((k) => k.id === drag.movingId);
  const refused = drag !== null && !movingHere && !Array.from(zones).some((key) => key.startsWith(prefix));
  return (
    <div
      role="group"
      aria-label={menuSideName(name, menuPosition)}
      data-menu-slot={name}
      data-menu-slot-id={holder.id}
      tabIndex={-1}
      className={`${side ? SIDE_SLOT : SLOT_CLASS[name]} ${SLOT_BOX} p-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-slate-brandLight`}
    >
      {kids.map((child, i) => renderNode(child, holder, i, kids.length))}
      {kids.length === 0 && drag === null && (
        <div className="w-full space-y-1">
          <DropZone parent={holder} index={0} position="fill" />
          <p className={NOTE}>{EMPTY_SLOT_HINT}</p>
        </div>
      )}
      {kids.length === 0 && drag !== null && !refused && <DropZone parent={holder} index={0} position="fill" />}
      {refused && drag !== null && <RefuseBox slotId={holder.id} text={refusalText(drag)} />}
    </div>
  );
}

/** The page links between the two sides, drawn like the runtime bar and not clickable. */
function PageLinks() {
  const { spec, menuPosition, page } = useDesign();
  const entries = menuEntries(spec);
  if (entries.length === 0) return null;
  const side = menuPosition === 'side';
  const { labelsOnly } = menuLook(spec.menu);
  return (
    <div aria-hidden="true" inert className={side ? '' : TOP_NAV_IN_BAR}>
      <ul className={side ? SIDE_LIST : TOP_LIST_WRAP}>
        {entries.map((entry) => {
          const Icon = labelsOnly ? undefined : navIcon(entry.icon);
          return (
            <li key={entry.pageId}>
              <span className={`${MENU_LINK} ${entry.pageId === page.id ? MENU_CURRENT : MENU_OTHER}`}>
                {Icon ? <Icon size={16} aria-hidden="true" /> : null}
                {entry.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The page (`children`) with the menu bar around it while the bar is on; just the page when it is off. */
export default function MenuCanvas({ renderNode, children }: { renderNode: RenderNode; children: ReactNode }) {
  const { menu } = useDesign();
  if (menu === null) return <>{children}</>;
  const side = menu.menuPosition === 'side';
  const bar = (
    <DesignContext.Provider value={menu}>
      <div
        data-menu-canvas=""
        data-menu-position={menu.menuPosition}
        className={side ? SIDE_RAIL : TOP_BAR}
        onClick={(e) => {
          e.stopPropagation();
          menu.select(null);
        }}
      >
        {side && (
          <span aria-hidden="true" data-menu-toggle="" className={SIDE_TOGGLE}>
            <PanelLeftClose size={16} aria-hidden="true" />
          </span>
        )}
        <Slot name="start" renderNode={renderNode} />
        <PageLinks />
        <Slot name="end" renderNode={renderNode} />
      </div>
    </DesignContext.Provider>
  );
  return side ? (
    <div className={SIDE_FRAME}>
      {bar}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  ) : (
    <div>
      {bar}
      {children}
    </div>
  );
}
