// Web build stub for zod/v4/core/to-json-schema.js (see index.js). Same export names. The two method factories return a function, because zod
// classic calls them while building a schema's "~standard" property; the function throws when someone asks for JSON schema output.
import { WEB_STUB_MESSAGE } from './message.js';

const unavailable = () => {
  throw new Error(WEB_STUB_MESSAGE);
};

export const initializeContext = unavailable;
export const handleUnrepresentable = unavailable;
export const processSchema = unavailable;
export { unavailable as process };
export const extractDefs = unavailable;
export const finalize = unavailable;
export const createToJSONSchemaMethod = () => unavailable;
export const createStandardJSONSchemaMethod = () => unavailable;
