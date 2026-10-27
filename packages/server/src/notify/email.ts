/**
 * Transactional email via Resend. Plain fetch — works on Workers.
 *
 * From app-a, minus its HTML templates, which were product copy rather than
 * infrastructure. Returns false instead of throwing: a failed notification
 * should not fail the request that triggered it.
 */

export type EmailConfig = {
  /** Absent disables sending. Local dev then logs instead. */
  apiKey?: string
  /** Default From, e.g. "Acme <noreply@mail.acme.com>". */
  from: string
  onEvent?: (event: string, data: Record<string, unknown>) => void
}

export type EmailMessage = {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  replyTo?: string
}

export function createEmailer(config: EmailConfig) {
  return {
    async send(msg: EmailMessage): Promise<boolean> {
      if (!config.apiKey) {
        config.onEvent?.("email.skipped", {
          to: msg.to,
          subject: msg.subject,
          reason: "no_api_key",
        })
        return false
      }
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: msg.from ?? config.from,
            to: msg.to,
            subject: msg.subject,
            ...(msg.html ? { html: msg.html } : {}),
            ...(msg.text ? { text: msg.text } : {}),
            ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
          }),
        })
        if (!res.ok) {
          config.onEvent?.("email.failed", {
            status: res.status,
            body: await res.text().catch(() => ""),
            to: msg.to,
          })
          return false
        }
        config.onEvent?.("email.sent", { to: msg.to, subject: msg.subject })
        return true
      } catch (err) {
        config.onEvent?.("email.error", { err: String(err), to: msg.to })
        return false
      }
    },
  }
}
