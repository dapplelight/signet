import type { Part } from "../../src/compose.js"

export default {
  description: "waitlist, invites, referrals, feedback and marks in your own database",
  apiOnly: true,
  tables: ["waitlist", "invites", "referral_codes", "referrals", "marks", "feedback"],
} satisfies Part
