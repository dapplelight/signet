### create-signet-app: notifications screen shows loading and error states

- The scaffolded notifications route no longer says "You're all caught up" while loading or after a failed load. It shows skeletons while loading and an error with a retry button when the inbox or the settings fail to load, each section independently.
- Failed mark read, mark all read, archive, load more and preference changes now show a toast with the server's message.
