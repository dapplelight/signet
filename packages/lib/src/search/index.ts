/**
 * Search engine: logic only, no UI, no dependencies, nothing app-specific. An app gives it sources (its items or
 * a find function), the readers it wants and its word list; it returns a best match and ranked sections as data.
 */
export * from "./engine.js"
export * from "./readers.js"
export * from "./text.js"
export * from "./usage.js"
