/**
 * Privacy tools for an agent acting for one person, as plain MCP tool
 * objects (see `tool-kit.ts`):
 *
 *   list_consents        consents in force, and the full history
 *   list_data_requests   the person's export and erasure requests
 *   withdraw_consent     withdraw one purpose                      approval
 *   request_data_export  open an export request                    approval
 *   request_erasure      open an erasure request                   approval
 *
 * Writes ALWAYS call `approve(ctx, { summary, details, args })`, acting only
 * when it returns undefined; with no `approve` they change nothing and return
 * APPROVAL_REQUIRED. Requests are only opened here: fulfilling them is a
 * staff action in code (`privacy.fulfil`).
 */

import type { Privacy } from "./privacy.js"
import { type Approve, bad, gated, obj, type PlainTool, str } from "./tool-kit.js"

export type PrivacyToolsOptions = {
  privacy: Privacy
  /** The person the agent acts for. */
  subject: string
  /** Undefined = approved; anything else is returned as the tool result. */
  approve?: Approve
}

const READ = { readOnlyHint: true, destructiveHint: false }

export function privacyTools(options: PrivacyToolsOptions): PlainTool[] {
  const { privacy: p, subject } = options
  if (!subject) throw bad("privacyTools needs the subject the agent acts for.")
  const gate = (
    ctx: unknown,
    summary: string,
    details: Record<string, unknown>,
    act: () => Promise<unknown>,
  ) => gated(options.approve, ctx, { summary, details, args: details }, act)
  return [
    {
      name: "list_consents",
      description:
        "What the person has agreed to: consents in force (purpose, notice version, when) and the full history including withdrawals.",
      annotations: READ,
      inputSchema: obj({}),
      run: async () => ({ active: await p.active(subject), history: await p.history(subject) }),
    },
    {
      name: "list_data_requests",
      description: "The person's data export and erasure requests and their status.",
      annotations: READ,
      inputSchema: obj({}),
      run: async () => ({ requests: await p.listRequests({ subject }) }),
    },
    {
      name: "withdraw_consent",
      description:
        "Withdraw the person's consent to one purpose. Always asks the person to approve first.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: obj({ purpose: { type: "string", minLength: 1 } }, ["purpose"]),
      run: async (i, ctx) => {
        const purpose = str(i, "purpose")
        return gate(ctx, `Withdraw consent to ${purpose}`, { purpose }, async () => ({
          withdrawn: await p.withdraw(subject, purpose),
        }))
      },
    },
    {
      name: "request_data_export",
      description:
        "Open a request for a copy of the person's data. Always asks the person to approve first.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: obj({}),
      run: async (_i, ctx) =>
        gate(ctx, "Request a copy of my data", {}, async () => p.requestExport(subject)),
    },
    {
      name: "request_erasure",
      description:
        "Open a request to erase the person's data. Staff carry it out; it cannot be undone once they do. Always asks the person to approve first.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: obj({}),
      run: async (_i, ctx) =>
        gate(ctx, "Request erasure of my data", {}, async () => p.requestErasure(subject)),
    },
  ]
}
