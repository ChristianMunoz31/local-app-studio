// What each build tool is called to the person. The Build step's tool table and the environment doctor both read this,
// so the two screens never name a tool differently.

/** What each tool is called to the person; an id not listed keeps the server's label. */
export const TOOL_WORDS: Readonly<Record<string, string>> = {
  node: 'Node.js',
  rustc: 'Rust',
  cargo: 'Cargo (comes with Rust)',
  msvc: 'Microsoft C++ build tools',
  winsdk: 'Windows SDK',
  webview2: 'WebView2 (shows the app window)',
};

/** @param item a toolchain item (only its id and label are read) */
export const toolName = (item: { id: string; label: string }): string => TOOL_WORDS[item.id] ?? item.label;
