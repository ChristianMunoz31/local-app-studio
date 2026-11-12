const REVOKE_DELAY_MS = 30_000;

/** Saves a blob as a file through a temporary link. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser reads the blob after click() returns; revoking at once can cancel the save.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** Saves a value as a pretty-printed JSON file through a temporary link. */
export function downloadJson(filename: string, value: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
}
