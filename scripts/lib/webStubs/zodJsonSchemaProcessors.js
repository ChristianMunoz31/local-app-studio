// Web build stub for zod/v4/core/json-schema-processors.js (see index.js). Same export names, all but one throw. `aggregateChecks` is kept as a
// verbatim copy of zod 4.6.7 (node_modules/zod/v4/core/json-schema-processors.js): classic schemas read `.format`, `.minLength` and `.minValue`
// through it, and that is behaviour the web build keeps. webStubs.test.js compares it with the installed file.
import { BIGINT_FORMAT_RANGES, NUMBER_FORMAT_RANGES } from "../../../node_modules/zod/v4/core/util.js";
import { WEB_STUB_MESSAGE } from "./message.js";

const unavailable = () => {
  throw new Error(WEB_STUB_MESSAGE);
};

const narrowMin = (agg, key, value) => {
    if (agg[key] === undefined || value > agg[key])
        agg[key] = value;
};
const narrowMax = (agg, key, value) => {
    if (agg[key] === undefined || value < agg[key])
        agg[key] = value;
};
const narrowBoth = (agg, value) => {
    narrowMin(agg, "minimum", value);
    narrowMax(agg, "maximum", value);
};
const addDivisor = (agg, value) => {
    agg.multipleOf ?? (agg.multipleOf = []);
    if (!agg.multipleOf.includes(value))
        agg.multipleOf.push(value);
};
const addPattern = (agg, pattern) => {
    agg.patterns ?? (agg.patterns = new Set());
    agg.patterns.add(pattern);
};
const intersectMime = (agg, mime) => {
    agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
// last-wins, matching the bag's historical write order; the flag keeps an integer format from being lost to a later float one
const setFormat = (agg, format) => {
    agg.format = format;
    if (format.includes("int"))
        agg.isInt = true;
};
const minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
const maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
const formatContributor = (ranges) => (agg, def) => {
    setFormat(agg, def.format);
    const [minimum, maximum] = ranges[def.format];
    narrowMin(agg, "minimum", minimum);
    narrowMax(agg, "maximum", maximum);
};
const contributors = {
    greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
    less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
    multiple_of: (agg, def) => addDivisor(agg, def.value),
    number_format: formatContributor(NUMBER_FORMAT_RANGES),
    bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
    min_length: minContributor,
    max_length: maxContributor,
    length_equals: (agg, def) => narrowBoth(agg, def.length),
    min_size: minContributor,
    max_size: maxContributor,
    size_equals: (agg, def) => narrowBoth(agg, def.size),
    string_format: (agg, def) => {
        setFormat(agg, def.format);
        if (def.pattern)
            addPattern(agg, def.pattern);
        if (def.format === "base64" || def.format === "base64url")
            agg.contentEncoding = def.format;
        if (def.local || def.precision === -1)
            agg.laxFormat = true;
    },
    mime_type: (agg, def) => intersectMime(agg, def.mime),
};
export function aggregateChecks(schema) {
    const agg = {};
    const def = schema._zod.def;
    // a format schema is its own first check, same rule as $ZodType init
    const list = schema._zod.traits.has("$ZodCheck")
        ? [schema, ...(def.checks ?? [])]
        : (def.checks ?? []);
    for (const ch of list)
        contributors[ch._zod.def.check]?.(agg, ch._zod.def);
    // reconcile with the bag so third-party onattach contributions still land; first-party residue is never tighter than the fold, so merging it back is idempotent for one and additive for the other
    const bag = schema._zod.bag;
    if (bag.minimum !== undefined)
        narrowMin(agg, "minimum", bag.minimum);
    if (bag.exclusiveMinimum !== undefined)
        narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
    if (bag.maximum !== undefined)
        narrowMax(agg, "maximum", bag.maximum);
    if (bag.exclusiveMaximum !== undefined)
        narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
    if (bag.multipleOf !== undefined)
        addDivisor(agg, bag.multipleOf);
    if (bag.format !== undefined) {
        agg.format ?? (agg.format = bag.format);
        if (bag.format.includes("int"))
            agg.isInt = true;
    }
    if (bag.mime)
        intersectMime(agg, bag.mime);
    for (const pattern of bag.patterns ?? [])
        addPattern(agg, pattern);
    return agg;
}

export const stringProcessor = unavailable;
export const numberProcessor = unavailable;
export const booleanProcessor = unavailable;
export const bigintProcessor = unavailable;
export const symbolProcessor = unavailable;
export const nullProcessor = unavailable;
export const undefinedProcessor = unavailable;
export const voidProcessor = unavailable;
export const neverProcessor = unavailable;
export const anyProcessor = unavailable;
export const unknownProcessor = unavailable;
export const dateProcessor = unavailable;
export const enumProcessor = unavailable;
export const literalProcessor = unavailable;
export const nanProcessor = unavailable;
export const templateLiteralProcessor = unavailable;
export const fileProcessor = unavailable;
export const successProcessor = unavailable;
export const customProcessor = unavailable;
export const functionProcessor = unavailable;
export const transformProcessor = unavailable;
export const mapProcessor = unavailable;
export const setProcessor = unavailable;
export const arrayProcessor = unavailable;
export const objectProcessor = unavailable;
export const unionProcessor = unavailable;
export const intersectionProcessor = unavailable;
export const tupleProcessor = unavailable;
export const recordProcessor = unavailable;
export const nullableProcessor = unavailable;
export const nonoptionalProcessor = unavailable;
export const defaultProcessor = unavailable;
export const prefaultProcessor = unavailable;
export const catchProcessor = unavailable;
export const pipeProcessor = unavailable;
export const readonlyProcessor = unavailable;
export const promiseProcessor = unavailable;
export const optionalProcessor = unavailable;
export const lazyProcessor = unavailable;
export const toJSONSchema = unavailable;
export const allProcessors = {};
