// The person never reads a tool name. A small model sometimes offers one ("use the list_records__products tool"), and a refusal
// sentence written for the model names the call. This pure pass swaps each tool name for plain words: a per-table list becomes
// "your <table label> list", anything else "the records". Pure: no I/O.

// An optional "the"/"a"/"an" before the name and an optional "tool"/"function" after it go with it.
const TOOL_NAME_RE = /(?:\b(?:the|a|an)\s+)?\b(list_records|get_stats|save_record|describe_data)(?:__(\w+))?\b(?:\s+(?:tool|function|command)\b)?/gi;

/**
 * @param {string} text
 * @param {(table: string) => string} [labelOf] the label of a table id (default: the id with spaces)
 * @returns {string}
 */
export function plainToolWords(text, labelOf = (id) => id.replace(/_/g, ' ')) {
  if (typeof text !== 'string' || !/(?:list_records|get_stats|save_record|describe_data)/i.test(text)) return text;
  return text.replace(TOOL_NAME_RE, (_m, verb, table) => {
    if (verb.toLowerCase() === 'list_records' && table) return `your ${labelOf(table)} list`;
    return 'the records';
  });
}
