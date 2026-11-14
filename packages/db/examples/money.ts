/** Money in integer minor units. `bun examples/money.ts` */
import { addMoney, compareMoney, formatMoney, type Money, moneyOf, sumMoney } from "../src"
import { createDb } from "../src/sqlite"
import * as schema from "./schema"

const db = createDb()
schema.migrate((sql) => db.orm.run(sql))
const rows = await db.orm
  .insert(schema.orders)
  .values([
    { userId: "u", item: "Masala dosa", total: 9000 },
    { userId: "u", item: "Idli", total: 6050 },
  ])
  .returning()

const totals = rows.map((r) => moneyOf(r, "total"))
const sum = sumMoney(totals)
console.log(formatMoney(sum)) // ₹150.50
console.log(formatMoney(addMoney(sum, { amount: 99, currency: "INR" }))) // ₹151.49
const [dosa, idli] = totals as [Money, Money]
console.log(compareMoney(dosa, idli)) // 1
try {
  addMoney(sum, { amount: 100, currency: "USD" })
} catch (e) {
  console.log((e as { code: string }).code) // CURRENCY_MISMATCH
}
