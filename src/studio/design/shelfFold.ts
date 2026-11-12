// Whether the Features shelf of Design is folded to a thin strip: a view choice only, kept per app in this browser
// (localStorage through lsKey), never in the spec. No stored choice reads as open.
import { useCallback, useState } from "react";
import { lsKey } from "@/utils/storageKeys.js";

const keyFor = (appId: string): string => lsKey(`studio.shelfFolded.${appId}`);

export function readShelfFolded(appId: string): boolean {
  try {
    return window.localStorage.getItem(keyFor(appId)) === "1";
  } catch {
    return false;
  }
}

export function writeShelfFolded(appId: string, folded: boolean): void {
  try {
    if (folded) window.localStorage.setItem(keyFor(appId), "1");
    else window.localStorage.removeItem(keyFor(appId));
  } catch {
    // Storage full or blocked: the choice is lost on reload, nothing else.
  }
}

export function useShelfFold(appId: string): {
  folded: boolean;
  setFolded(folded: boolean): void;
} {
  const [stored, setStored] = useState<{ appId: string; folded: boolean }>(
    () => ({ appId, folded: readShelfFolded(appId) }),
  );
  const folded =
    stored.appId === appId ? stored.folded : readShelfFolded(appId);
  const setFolded = useCallback(
    (next: boolean): void => {
      writeShelfFolded(appId, next);
      setStored({ appId, folded: next });
    },
    [appId],
  );
  return { folded, setFolded };
}
