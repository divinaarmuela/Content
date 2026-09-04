import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A static floor under the owner's rule.
 *
 * The behavioural tests prove the confirm gate works. This one proves there is
 * no SECOND way in: a page this size grows, and the way "nothing moves without
 * a person" stops being true is not a broken gate — it is somebody adding a
 * second caller a year from now, in a helper that felt harmless.
 *
 * So the rule is stated as a property of the source itself. It reads the files
 * rather than importing them on purpose: an import proves what the code does
 * when it runs, and this is about what the code CAN do at all.
 *
 * Comments are stripped before anything is matched. Half of this file's
 * subject matter is discussed in the docblocks that explain it, and a test
 * that fails because somebody wrote down WHY there is no delete would be a
 * test that punishes the explanation.
 */

const ROOTS = ['app/api/drive', 'app/dashboard/files']

/** The code, without the prose about the code. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line))
    .map(line => line.replace(/\s\/\/.*$/, ''))
    .join('\n')
}

function sourcesUnder(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourcesUnder(path))
    else if (/\.tsx?$/.test(name)) {
      out.push({ path: path.split('\\').join('/'), text: code(readFileSync(path, 'utf8')) })
    }
  }
  return out
}

const sources = ROOTS.flatMap(sourcesUnder)
const paths = (files: { path: string }[]) => files.map(f => f.path).sort()

describe('only a confirmed Move re-parents anything', () => {
  it('has exactly one file that can change a file’s folder', () => {
    expect(paths(sources.filter(f => /moveDriveFile|addParents|removeParents/.test(f.text))))
      .toEqual(['app/api/drive/move/route.ts'])
  })

  it('and that file refuses BEFORE the write, not after it', () => {
    const route = code(readFileSync('app/api/drive/move/route.ts', 'utf8'))
    const refusal = route.indexOf('confirmRefusal(')
    const write = route.indexOf('await moveDriveFile(')
    expect(refusal).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(write)
  })

  it('sends confirm: true only from a dialog a person pressed', () => {
    const senders = sources.filter(f =>
      /confirm:\s*true/.test(f.text) && f.path.startsWith('app/dashboard/'))
    const anywhere = sources.filter(f => /confirm:\s*true/.test(f.text))
    // the browser half sends it from exactly one place…
    expect(paths(senders)).toEqual(['app/dashboard/files/FilesDialogs.tsx'])
    // …and the server half only ever READS it (the routes name it to refuse it)
    expect(paths(anywhere.filter(f => f.path.startsWith('app/api/')))).toEqual([])
  })

  it('never re-parents as a side effect of a drop', () => {
    // a drop hands the page a folder; the page opens a question. If a drop
    // handler ever called the move route directly, this would fail.
    for (const file of sources) {
      if (!/onDropOnto|onDrop=/.test(file.text)) continue
      expect(file.text, file.path).not.toMatch(/api\/drive\/move/)
    }
  })
})

describe('nothing on this page deletes anything', () => {
  it('has no delete or trash route', () => {
    const names = readdirSync('app/api/drive')
    expect(names).not.toContain('delete')
    expect(names).not.toContain('trash')
  })

  it('never asks Drive to trash a file, from anywhere in the page or its routes', () => {
    for (const file of sources) {
      expect(file.text, file.path).not.toMatch(/trashed:\s*true/)
      expect(file.text, file.path).not.toMatch(/method:\s*'DELETE'/)
    }
  })

  it('never revokes anybody’s access — sharing only ever adds', () => {
    for (const file of sources) {
      expect(file.text, file.path).not.toMatch(/revokePermission/)
    }
  })
})

describe('a read path cannot settle where the filing cabinet is', () => {
  it('never calls rootFolderId or ensureRootFolder — both of which create', () => {
    const all = [
      ...sources,
      { path: 'app/lib/drive-page.ts', text: code(readFileSync('app/lib/drive-page.ts', 'utf8')) },
    ]
    expect(paths(all.filter(f => /\brootFolderId\s*\(|ensureRootFolder/.test(f.text)))).toEqual([])
  })

  it('never writes root_folder_id', () => {
    for (const file of sources) {
      expect(file.text, file.path).not.toMatch(/root_folder_id/)
    }
  })
})
