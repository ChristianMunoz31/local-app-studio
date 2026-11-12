// What an edit of a table tells the Data step: the label of the undo step, a key that merges typing into one step,
// and, for adding or removing a field, the notice to show with Undo.
export interface ChangeMeta {
  label: string;
  coalesceKey?: string;
  notice?: string;
}
