// Parser for `git worktree list --porcelain` (pure). The first entry is the main checkout, the rest are worktrees.

/**
 * @param {string} porcelain output of `git worktree list --porcelain`
 * @returns {{ main: string, worktrees: { path: string, branch: string, head: string }[] }}
 *   `main` is the main checkout path ('' when the text has no entry); `branch` is '' for a detached HEAD.
 */
export function parseWorktreeList(porcelain) {
  const entries = [];
  let cur = null;
  for (const raw of String(porcelain).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length), branch: '', head: '' };
      entries.push(cur);
    } else if (cur && line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length);
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === '') {
      cur = null;
    }
  }
  const [first, ...rest] = entries;
  return { main: first ? first.path : '', worktrees: rest };
}
