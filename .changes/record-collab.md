### signet-db: comments, mentions, activity timeline and version history

- New `./collab`: `createCollab(db, { tables: { comments }, records, orgs, people?, notify?, access?, describe? })` with `collabTables()` (`comments`, `recordVersions`) in `./columns/sqlite` and `./columns/pg`. Comment threads on any org record with replies, edit (`editedAt` marker) and soft delete; `@[Name](user:<id>)` mentions (`parseMentions`, `mentionToken`) kept only for org members and notified once per person per comment, however often it is edited; `mentionable(who, query)` for a picker; `timeline(who, ref)` merges the audit log and comments, newest first and cursor-paginated, each item with field `changes` and a `summary` ("Asha changed status to Done", `describeItem`); `versions`, `diff`, `restore` (a new version plus a `restore` audit entry) and `undo` (409 when `expected` is stale or the record changed outside its history). Deny by default: only tables in `records`, another org's record or a non-member is 404; restore and undo need `<record>:write`.
- `DbConfig.versions: { table, track }` turns on version snapshots per table: every `scoped`/`audited` insert, update and delete on a tracked table writes the next version of the row.

### signet-server: collab routes

- New `./http/collab`: `collabRoutes({ collab, userId })` mounts comments, the mention picker, the timeline, versions, diff, restore and undo in the request's tenant; 401 signed out, 404 across orgs. `mentionTemplates({ url })` is a `comment.mention` template (email and in-app, `mentions` category for preferences) and `notifyMentions(notifier)` sends it keyed by the mention, so nobody is told twice.

### signet-ui: collab screens

- New `./screens/collab-screens`: `CommentThreads`, `MentionTextarea` (an `@` member picker that stores mentions by id), `ActivityFeed` with Load more, and `VersionHistory` with `VersionDiff`, Restore and Undo. Showcase page `screens-collab.html`.

### signet-mcp: add-collab recipe

- `recipe("add-collab")`: comments, mentions, timeline and version history from the db and server READMEs.
