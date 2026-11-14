/**
 * Database tools for AI agents, safe by construction: `agentTools(db, {
 * tables, userId })` returns plain tool definitions (list, get, search per
 * table, plus insert and update only with `allowWrites`).
 *
 * Every tool runs through `scoped(db, { userId })`: the agent sees and
 * changes only that user's rows, never soft-deleted ones, at most `maxRows`
 * at a time, and never encrypted fields unless `includeEncrypted`. Writes are
 * audited as `{ type: "agent", id }` when the db has an audit table, and take
 * `dryRun: true` to return the would-be change without writing.
 *
 * Each tool has `input` (a Zod object) and `handler`, the shape signet-server's
 * `createMcpServer({ tools })` registers directly, and also `inputSchema`
 * (JSON Schema) and `run` for any other runner.
 */

import { type Column, desc, eq, getTableName, is, sql, Table } from "drizzle-orm"
import { z } from "zod"
import { columnsOf, isEncrypted, type SignetDb } from "./db.js"
import { SignetDbError } from "./errors.js"
import { type Actor, audited, type Ops, scoped } from "./scoped.js"
import { toZod } from "./zod.js"

export type AgentTool = {
  readonly name: string
  readonly description: string
  readonly annotations: { readOnlyHint: boolean; destructiveHint: boolean }
  /** Zod object schema of the input (what signet-server's MCP registration reads). */
  readonly input: z.ZodType<Record<string, unknown>>
  /** The same input as JSON Schema. */
  readonly inputSchema: Record<string, unknown>
  /** Validates the input, then runs. Throws SignetDbError("BAD_INPUT") on bad input. */
  run(input: unknown): Promise<unknown>
  /** Same as `run`; the name signet-server's MCP registration calls. */
  handler(input: unknown): Promise<unknown>
}

export type AgentToolsOptions = {
  /** Tables to expose, as a list or a schema module. Each must have a `userId` column. */
  tables: readonly Table[] | Record<string, unknown>
  /** The user the agent acts for. */
  userId: string
  /** Recorded in the audit log. Default `{ type: "agent", id: "agent" }`. */
  actor?: Actor
  /** Add insert and update tools. Default false. */
  allowWrites?: boolean
  /** Most rows any call returns. Default 100. */
  maxRows?: number
  /** Expose encrypted columns (decrypted). Default false. */
  includeEncrypted?: boolean
}

type Rec = Record<string, unknown>
type Shape = Record<string, z.ZodType>

const jsonSchema = (s: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(s, {
    io: "input",
    unrepresentable: "any",
    override: (ctx) => {
      const def = (ctx.zodSchema as unknown as { _zod: { def: { type: string } } })._zod.def
      if (def.type === "date")
        Object.assign(ctx.jsonSchema, { type: "string", format: "date-time" })
    },
  }) as Record<string, unknown>

function parse<S extends z.ZodType>(schema: S, input: unknown, tool: string): z.output<S> {
  const r = schema.safeParse(input ?? {})
  if (r.success) return r.data
  const issues = r.error.issues.map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
  throw new SignetDbError(
    "BAD_INPUT",
    `Invalid input for ${tool}: ${issues.join("; ")}. Fix these fields and retry.`,
  )
}

export function agentTools<TOrm>(db: SignetDb<TOrm>, options: AgentToolsOptions): AgentTool[] {
  const { userId, allowWrites = false, maxRows = 100, includeEncrypted = false } = options
  const actor = options.actor ?? { type: "agent", id: "agent" }
  const list = (
    Array.isArray(options.tables) ? options.tables : Object.values(options.tables)
  ).filter((t): t is Table => is(t, Table))
  const reader = scoped(db, { userId })
  const writer: Ops = db.audit ? audited(reader, { actor }) : reader

  const tools: AgentTool[] = []
  const add = (
    name: string,
    description: string,
    shape: Shape,
    readOnly: boolean,
    fn: (input: Rec) => Promise<unknown>,
  ) => {
    const input = z.object(shape).strict()
    const run = async (raw: unknown) => fn(parse(input, raw, name))
    tools.push({
      name,
      description,
      annotations: { readOnlyHint: readOnly, destructiveHint: false },
      input,
      inputSchema: jsonSchema(input),
      run,
      handler: run,
    })
  }

  for (const table of list) {
    const name = getTableName(table)
    const cols = columnsOf(table)
    if (!cols.userId) {
      throw new SignetDbError(
        "NO_OWNER_COLUMN",
        `agentTools: table ${name} has no userId column, so it cannot be scoped to a user. Leave it out of tables.`,
      )
    }
    const pk = Object.keys(cols).find((k) => cols[k]?.primary)
    const hidden = new Set(
      Object.keys(cols).filter(
        (k) => k === "userId" || (!includeEncrypted && isEncrypted(cols[k] as Column)),
      ),
    )
    const visible = Object.keys(cols).filter((k) => !hidden.has(k))
    const strip = (rows: Rec[]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.has(k))))
    const limit = z.number().int().min(1).max(maxRows).optional().describe(`At most ${maxRows}.`)
    const offset = z.number().int().min(0).optional()
    const searchable = visible.filter((k) => !isEncrypted(cols[k] as Column))

    add(
      `${name}_list`,
      `List the user's ${name} rows by primary key, descending (newest first with id() keys). At most ${maxRows} per call; page with offset.`,
      { limit, offset },
      true,
      async (i) =>
        strip(
          await reader.select(table, undefined, {
            limit: (i.limit as number | undefined) ?? maxRows,
            offset: i.offset as number | undefined,
            ...(pk ? { orderBy: desc(cols[pk] as Column) } : {}),
          }),
        ),
    )

    if (pk) {
      add(
        `${name}_get`,
        `Get one of the user's ${name} rows by ${pk}, or null.`,
        { [pk]: z.string() },
        true,
        async (i) => {
          const rows = await reader.select(table, eq(cols[pk] as Column, i[pk]), { limit: 1 })
          return strip(rows)[0] ?? null
        },
      )
    }

    if (searchable.length) {
      add(
        `${name}_search`,
        `Find the user's ${name} rows where a column equals a value, or (mode "contains") contains text. At most ${maxRows}.`,
        {
          column: z.enum(searchable as [string, ...string[]]),
          value: z.union([z.string(), z.number(), z.boolean()]),
          mode: z.enum(["equals", "contains"]).optional(),
          limit,
        },
        true,
        async (i) => {
          const col = cols[i.column as string] as Column
          const value = i.value as string | number | boolean
          const cond =
            i.mode === "contains"
              ? sql`${col} like ${`%${String(value).replace(/[\\%_]/g, (m) => `\\${m}`)}%`} escape '\\'`
              : eq(col, value)
          return strip(
            await reader.select(table, cond, { limit: (i.limit as number | undefined) ?? maxRows }),
          )
        },
      )
    }

    if (!allowWrites) continue
    const pick = (s: z.ZodType) => {
      const shape = (s as unknown as z.ZodObject<Shape>).shape
      return Object.fromEntries(Object.entries(shape).filter(([k]) => !hidden.has(k))) as Shape
    }
    const insertShape = pick(toZod(table, { mode: "insert" }))
    const updateShape = pick(toZod(table, { mode: "update" }))
    const dryRun = z.boolean().optional().describe("Return the change without writing it.")

    add(
      `${name}_insert`,
      `Create a ${name} row for the user. dryRun: true returns the row that would be written.`,
      { values: z.object(insertShape).strict(), dryRun },
      false,
      async (i) => {
        const values = i.values as Rec
        if (i.dryRun) return { dryRun: true, wouldInsert: { ...values } }
        return strip(await writer.insert(table, values as never))[0]
      },
    )

    if (pk && Object.keys(updateShape).length) {
      add(
        `${name}_update`,
        `Change fields of one of the user's ${name} rows by ${pk}. dryRun: true returns before and after without writing.`,
        { [pk]: z.string(), set: z.object(updateShape).strict(), dryRun },
        false,
        async (i) => {
          const where = eq(cols[pk] as Column, i[pk])
          const set = i.set as Rec
          if (i.dryRun) {
            const [before] = strip(await reader.select(table, where, { limit: 1 }))
            if (!before) throw notFound(name, pk, i[pk])
            return { dryRun: true, before, after: { ...before, ...set } }
          }
          const [row] = strip(await writer.update(table, set as never, where))
          if (!row) throw notFound(name, pk, i[pk])
          return row
        },
      )
    }
  }
  return tools
}

const notFound = (table: string, pk: string, id: unknown) =>
  new SignetDbError(
    "NOT_FOUND",
    `No ${table} row with ${pk} "${String(id)}" for this user. Use ${table}_list or ${table}_search to find it.`,
  )
