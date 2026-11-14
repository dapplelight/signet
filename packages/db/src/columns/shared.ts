/** Internal: camelCase JS key → snake_case SQL name. */
export const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
