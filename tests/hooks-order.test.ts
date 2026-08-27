import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * No hook after an early return.
 *
 * The item page went blank for every item ("This page couldn't load", React
 * error #310 — rendered more hooks than during the previous render) because a
 * `useEffect` had been added BELOW the `if (!detail) return <Skeleton />`
 * guard. First render: no detail, hooks stop at the guard. Second render:
 * detail arrived, one more hook — React refuses. Nothing in the repo caught it:
 * there is no eslint react-hooks plugin and no DOM test environment.
 *
 * This scan does the rules-of-hooks check for that one shape, across every
 * client file under app/: inside each top-level function, a `return` at the
 * function's own indentation (two spaces) must not be followed by a `use*(`
 * call at that same indentation. Nested blocks (deeper indentation) are
 * ignored, which is what keeps it from flagging `if (x) return` inside an
 * effect or a callback.
 */

const ROOT = join(__dirname, '..', 'app')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

/** a bare `return` or `if (...) return` at the component's own indentation */
const EARLY_RETURN = /^  (return\b|if \(.*\) return\b)/
/** `  if (...) {` — a component-level guard block; a `    return` inside it
 *  is the same early return, one level down */
const GUARD_OPEN = /^  (if|} else if|} else)\b.*\{\s*$/
const GUARD_CLOSE = /^  \}/
const GUARD_RETURN = /^    return\b/
const HOOK_CALL = /^  (?:const |let |)(?:\[?[\w, ]*\]?\s*=\s*)?use[A-Z]\w*\(/
const FN_START = /^(export (default )?)?(async )?function \w+|^(export )?const \w+ = (forwardRef|memo)\b/

export function hooksAfterReturn(src: string): number[] {
  const bad: number[] = []
  let returned = false
  let inGuard = false
  src.split('\n').forEach((line, i) => {
    if (FN_START.test(line)) { returned = false; inGuard = false; return }
    if (GUARD_OPEN.test(line)) { inGuard = true; return }
    if (inGuard && GUARD_RETURN.test(line)) { returned = true; return }
    if (GUARD_CLOSE.test(line)) { inGuard = false; return }
    if (EARLY_RETURN.test(line)) { returned = true; return }
    if (returned && HOOK_CALL.test(line)) bad.push(i + 1)
  })
  return bad
}

describe('rules of hooks: no hook below a component-level early return', () => {
  const files = walk(ROOT).filter(f => /^'use client'/.test(readFileSync(f, 'utf8')))
  it('scans the client components', () => { expect(files.length).toBeGreaterThan(20) })

  for (const f of files) {
    it(relative(ROOT, f), () => {
      expect(hooksAfterReturn(readFileSync(f, 'utf8'))).toEqual([])
    })
  }

  it('catches the shape that broke the item page', () => {
    const broken = [
      "export default function Page() {",
      "  const [detail, setDetail] = useState(null)",
      "  if (!detail) {",
      "    return null",
      "  }",
      "  useEffect(() => {}, [])",
      "  return <div />",
      "}",
    ].join('\n')
    // the block form — exactly what the item page had
    expect(hooksAfterReturn(broken)).toEqual([6])
    // the one-line form
    const oneLine = broken.replace("  if (!detail) {\n    return null\n  }", "  if (!detail) return null")
    expect(hooksAfterReturn(oneLine)).toEqual([4])
    // the same hook ABOVE the guard is fine
    const fixed = broken.replace("  useEffect(() => {}, [])\n", '').replace(
      "  if (!detail) {", "  useEffect(() => {}, [])\n  if (!detail) {")
    expect(hooksAfterReturn(fixed)).toEqual([])
    // a return inside a nested callback is not an early return
    const nested = [
      "function A() {",
      "  const go = useCallback(() => {",
      "    if (x) return",
      "  }, [])",
      "  useEffect(() => {}, [])",
      "  return null",
      "}",
    ].join('\n')
    expect(hooksAfterReturn(nested)).toEqual([])
  })
})
