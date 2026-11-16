// The few chrome.* calls this template makes, typed by shape so the template
// needs no @types/chrome. Swap in @types/chrome when you use more of the API.
declare const chrome: {
  identity: {
    getRedirectURL(path?: string): string
    launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>
  }
  runtime: {
    sendMessage(message: unknown): Promise<unknown>
    openOptionsPage(): Promise<void>
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | undefined,
      ): void
    }
  }
  storage: {
    onChanged: {
      addListener(listener: (changes: Record<string, unknown>, area: string) => void): void
    }
  }
}
