#!/usr/bin/env bun
// Checks scripts/check-mdx.ts on the prose that broke the docs build, and on valid MDX it must leave alone.
import { checkMdx } from "./check-mdx.ts"

let fail = 0
const ok = (name: string, c: boolean) => {
  if (!c) fail++
  console.log(c ? "  PASS" : "  FAIL", name)
}
const lines = (src: string) => checkMdx(src).map((p) => p.line)

// The three real breakages.
const tag = checkMdx("# T\n\nPass the <reason> to the handler.\n")
ok("unclosed <reason> is flagged on its line", tag.length === 1 && tag[0].line === 3)
ok("message says to use backticks", tag[0].message.includes("Wrap it in backticks: `<reason>`"))
ok("<$0.01 is flagged", lines("Costs less than <$0.01 per call.\n").join() === "1")
const brace = checkMdx("one\n\nThe {total} is shown.\n")
ok("bare {total} is flagged on its line", brace.length === 1 && brace[0].line === 3)
ok("message names the text", brace[0].message.includes("`{total}`"))

// Other non-tag characters after <.
ok("<= is flagged", lines("a <= b").length === 1)
ok("<3 is flagged", lines("x <3").length === 1)
ok("an autolink <https://x.dev> is flagged", lines("see <https://x.dev>").length === 1)
ok("an HTML comment is flagged", lines("<!-- note -->").length === 1)

// Valid MDX stays quiet.
ok("a < b with a space is plain text", lines("if a < b then").length === 0)
ok("balanced components pass", lines('<Callout type="warn">\nCareful.\n</Callout>\n').length === 0)
ok(
  "nested components, self-closing and fragments pass",
  lines('<Cards>\n  <Card title="a" href="/a" />\n</Cards>\n<>\n  hi\n</>\n').length === 0,
)
ok("a > inside an attribute expression passes", lines("<Foo bar={a > b}>x</Foo>").length === 0)
ok(
  "<Tab> with {...} props passes",
  lines("<Tabs items={['a', 'b']}>\n<Tab>x</Tab>\n</Tabs>").length === 0,
)
ok("inline code is skipped", lines("Use `<reason>` and `{total}` and `<$0.01`.").length === 0)
ok("double-backtick inline code is skipped", lines("Use ``a <b {c}`` here.").length === 0)
ok("fenced code is skipped", lines("```ts\nconst x = <reason>{total}\n```\n").length === 0)
ok(
  "a longer fence holds a shorter one",
  lines("````md\n```\n<reason>\n```\n{x}\n````\n").length === 0,
)
ok("~~~ fences are skipped", lines("~~~\n<$0.01\n~~~\n").length === 0)
ok(
  "an indented fence in a component is skipped",
  lines("<Tab>\n  ```ts\n  <reason>{total}\n  ```\n</Tab>\n").length === 0,
)
ok("prose after a fence is checked again", lines("```\nx\n```\n{total}\n").join() === "4")
ok("frontmatter is skipped", lines('---\ntitle: "<reason> {total}"\n---\n\nbody\n').length === 0)
ok("import lines are skipped", lines('import { A, B } from "../x"\n\n<A />\n').length === 0)
ok("a multi-line import is skipped", lines('import {\n  A,\n  B,\n} from "../x"\n').length === 0)
ok("MDX comments and string expressions pass", lines('{/* note */}\n\na {" "} b\n').length === 0)
ok("backslash-escaped < and { pass", lines("a \\<reason> and \\{total}").length === 0)

// Tag balance.
ok("a stray closing tag is flagged", lines("hello </b>").length === 1)
ok("a tag closed by the wrong name is flagged", lines("<Tab>\nx\n</Tabs>\n").length >= 1)
ok(
  "line numbers are right after code blocks",
  lines("a\n```\nx\ny\n```\nb <reason>\n").join() === "6",
)

console.log(fail ? `\n${fail} failed` : "\nall passed")
process.exit(fail ? 1 : 0)
