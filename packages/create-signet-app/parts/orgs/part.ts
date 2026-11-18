import type { Part } from "../../src/compose.js"

export default {
  description: "organisations: a personal org each, members, roles, invite links, org pages",
  needs: ["auth"],
  tables: ["organizations", "memberships", "invitations", "org_roles"],
} satisfies Part
