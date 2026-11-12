// Plain-language names for the app's data types, used where a table id would otherwise show
// (restore preview). Keep in sync with the labels in server/dataTables.js.
export const TABLE_LABELS = Object.freeze({
  studio_features: 'Features',
  assistant_conversations: 'Assistant conversations',
  assistant_messages: 'Assistant messages',
  app_state: 'Preferences',
});

/** Friendly label for a table id; unknown ids fall back to the id. */
export const tableLabel = (id) => TABLE_LABELS[id] ?? id;
