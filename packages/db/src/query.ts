/**
 * Named, reusable queries as plain objects: `{ key, run(db) }`.
 *
 * The key identifies the query and its inputs (for caching, logging, tracing
 * or devtools); `run` does the work. Define them once next to the schema and
 * call them from route handlers, jobs and tests alike.
 *
 * ```ts
 * const openTodos = (userId: string) =>
 *   defineQuery({
 *     key: ["todos", "open", userId],
 *     run: (db: SignetDb) => scoped(db, { userId }).select(todos, eq(todos.done, false)),
 *   })
 * const rows = await openTodos("u1").run(db)
 * ```
 */

export type QueryDef<TDb, TResult, TKey extends readonly unknown[] = readonly unknown[]> = {
  readonly key: TKey
  run(db: TDb): Promise<TResult>
}

/** Identity at runtime; infers the key tuple and the result type. */
export function defineQuery<TDb, TResult, const TKey extends readonly unknown[]>(
  def: QueryDef<TDb, TResult, TKey>,
): QueryDef<TDb, TResult, TKey> {
  return def
}
