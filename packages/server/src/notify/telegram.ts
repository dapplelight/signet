/**
 * Telegram messages. Plain fetch — works on Workers.
 *
 * Carries app-a's warning, which is the reason this file exists separately from
 * per-user notification: the chat is a single operator-owned channel, so
 * anything sent here is visible to the operator and nobody else's data belongs
 * in it. Use web push for per-user messages.
 */

export type TelegramConfig = {
  botToken?: string
  chatId?: string
  onEvent?: (event: string, data: Record<string, unknown>) => void
}

/** Escape MarkdownV2 reserved characters. Unescaped, they 400 the API. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1")
}

export function createTelegram(config: TelegramConfig) {
  return {
    /**
     * OPERATOR-level message only. Never pass user or household data — amounts,
     * names, account identifiers. This chat is not per-user.
     */
    async send(title: string, message: string): Promise<boolean> {
      if (!config.botToken || !config.chatId) return false
      try {
        const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: config.chatId,
            text: `*${escapeMarkdown(title)}*\n${escapeMarkdown(message)}`,
            parse_mode: "MarkdownV2",
          }),
        })
        if (!res.ok) {
          config.onEvent?.("telegram.failed", {
            status: res.status,
            body: await res.text().catch(() => ""),
          })
          return false
        }
        return true
      } catch (err) {
        config.onEvent?.("telegram.error", { err: String(err) })
        return false
      }
    },
  }
}
