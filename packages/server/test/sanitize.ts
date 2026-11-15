/** sanitizeMarkdown: XSS through raw HTML and link targets, and what it must leave alone. */
import { isSafeLinkTarget, sanitizeMarkdown } from "../src/http/sanitize"

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean | undefined, d: unknown = "") => {
  c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))
}
const same = (n: string, md: string) => ok(n, sanitizeMarkdown(md) === md, sanitizeMarkdown(md))
const is = (n: string, md: string, want: string) =>
  ok(n, sanitizeMarkdown(md) === want, sanitizeMarkdown(md))

// Raw HTML becomes text.
is("script tag", "<script>alert(1)</script>", "\\<script>alert(1)\\</script>")
is("img onerror", '<img src=x onerror="alert(1)">', '\\<img src=x onerror="alert(1)">')
is("svg onload", "<svg/onload=alert(1)>", "\\<svg/onload=alert(1)>")
is("comment", "<!-- x --><iframe src=//e>", "\\<!-- x -->\\<iframe src=//e>")
is("autolink with a javascript target", "<javascript:alert(1)>", "\\<javascript:alert(1)>")
is("an already escaped < stays", "a \\< b", "a \\< b")

// Link and image targets.
is("javascript link", "[x](javascript:alert(1))", "[x](#)")
is("mixed case", "[x](JaVaScRiPt:alert(1))", "[x](#)")
is("entity-encoded scheme", "[x](jav&#x61;script:alert(1))", "[x](#)")
is("decimal entity", "[x](&#106;avascript:alert(1))", "[x](#)")
is("named entity colon", "[x](javascript&colon;alert(1))", "[x](#)")
is("tab inside the scheme", "[x](java\tscript:alert(1))", "[x](#)")
is("percent-encoded scheme", "[x](javascript%3Aalert(1))", "[x](#)")
is("data URL image", "![a](data:text/html;base64,PHNjcmlwdD4=)", "![a](#)")
is("vbscript", "[x](vbscript:msgbox(1))", "[x](#)")
is("unknown entity in a scheme", "[x](java&foo;script:alert(1))", "[x](#)")
is("leading spaces before the target", "[x](   javascript:alert(1))", "[x](   #)")
is("angle-bracket target", "[x](<javascript:alert(1)>)", "[x](#)")
is("reference definition", "[x]: javascript:alert(1)\n\n[go][x]", "[x]: #\n\n[go][x]")
is("title after a bad target is kept", '[x](javascript:a "t")', '[x](# "t")')

same("https link", "[docs](https://example.com/a(b)?q=1:2#h)")
same("relative, anchor and root links", "[a](/p) [b](#top) [c](../x) [d](?q=a:b)")
same("mailto and tel", "[m](mailto:a@example.com) [t](tel:+911234)")
is("angle-bracket targets are escaped", "[a](<https://x.io>)", "[a](\\<https://x.io>)")
is("an escaped backslash before < does not hide it", "[a](x\\\\<b>)", "[a](x\\\\\\<b>)")
is(
  "html after ]( without a link is escaped",
  "a](<script>alert(1)</script>",
  "a](\\<script>alert(1)\\</script>",
)
same("reference to a safe target", "[x]: https://example.com")
same("mention token", "hi @[Asha Rao](user:u1) and @[Dev](user:u_2.b)")
same("formatting", "# T\n\n**b** _i_ `c`\n\n- a\n  1. b")
same("code span with html", "use `<b>` and ``a ` <i>``")
same("fenced code with html and links", "```\n<script>x</script>\n[x](javascript:y)\n```\nafter")
same("tilde fence", "~~~\n<b>\n~~~")
is("text after a code span is still cleaned", "`ok` <b>", "`ok` \\<b>")
is("unclosed fence keeps the rest as code", "```\n<b>", "```\n<b>")

// Characters.
is("control characters go", "a\u0000b\u0007c\u001bd", "abcd")
is("bidi overrides go", "abc\u202Edef\u2066g", "abcdefg")
is("CRLF to LF, tabs kept", "a\r\nb\tc\rd", "a\nb\tc\nd")

// Idempotent.
for (const md of ["<script>", "[x](javascript:a)", "`<b>` <i>", "a \\< b", "[a](<https://x.io>)"]) {
  const once = sanitizeMarkdown(md)
  ok(`idempotent: ${md}`, sanitizeMarkdown(once) === once, [once, sanitizeMarkdown(once)])
}

// isSafeLinkTarget directly.
ok("http safe", isSafeLinkTarget("http://x.io"))
ok("protocol-relative safe", isSafeLinkTarget("//x.io/p"))
ok("colon after a slash is a path", isSafeLinkTarget("/a:b"))
ok("file unsafe", !isSafeLinkTarget("file:///etc/passwd"))
ok("blob unsafe", !isSafeLinkTarget("blob:https://x"))

// Fuzz: no output may contain a raw tag opener or an unsafe target outside code.
const pieces = [
  "<",
  ">",
  "[",
  "]",
  "(",
  ")",
  "javascript:",
  "&#x6a;",
  "`",
  "\\",
  "a",
  " ",
  "\n",
  ":",
  "&colon;",
  "!",
]
// Seeded, so a failure reproduces.
let seed = 42
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed / 2 ** 31
}
let bad = ""
for (let n = 0; n < 20000 && !bad; n++) {
  let s = ""
  for (let k = 0; k < 14; k++) s += pieces[Math.floor(random() * pieces.length)]
  const out = sanitizeMarkdown(s)
  if (out.includes("`")) continue // code spans are left as written by design
  if (/(^|[^\\])(\\\\)*</.test(out)) bad = `${JSON.stringify(s)} -> ${JSON.stringify(out)}`
  for (const m of out.matchAll(/(?<!\\)\]\(\s*([^\s)]*)/g))
    if (!isSafeLinkTarget(m[1] as string)) bad = `${JSON.stringify(s)} -> ${JSON.stringify(out)}`
}
ok("fuzz: no raw < and no unsafe target", !bad, bad)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
