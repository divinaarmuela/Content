import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * THE DASHBOARD DOES NOT WRITE TO GOOGLE DRIVE.
 *
 * The owner's ruling, in their words: "didn't I tell you there should be no
 * writes… this feature is supposed to just pick a file that they wanna post."
 * HQ is the agency's real archive — years of client folders, shared with
 * clients, a bookkeeper and two freelance editors — and the dashboard is a
 * window onto it, not a drawer in it.
 *
 * The behavioural tests prove the routes refuse. This one proves there is no
 * SECOND way in: a page this size grows, and the way "the dashboard does not
 * write" stops being true is not a broken switch — it is somebody wiring an
 * Upload button back in a year from now because it seemed harmless.
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

const PAGES = ['app/dashboard/files', 'app/dashboard/social/schedule']
const ROUTES = ['app/api/drive']

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

const pages = PAGES.flatMap(sourcesUnder)
const routes = ROUTES.flatMap(sourcesUnder)
/** The Files page alone. The Schedule composer uploads too — to OUR storage,
 *  through the presign route — and deletes social accounts of ours, so the
 *  "no upload control, no DELETE" rules below are about Drive's window, not
 *  about every page that happens to touch a file. */
const filesPage = pages.filter(p => p.path.startsWith('app/dashboard/files'))
const sources = [...filesPage, ...routes]
const paths = (files: { path: string }[]) => files.map(f => f.path).sort()

/** The routes that would change something in the owner's Drive. */
const WRITE_ROUTES = [
  '/api/drive/folder',
  '/api/drive/move',
  '/api/drive/rename',
  '/api/drive/share',
  '/api/drive/upload/start',
  '/api/drive/upload/chunk',
]

describe('no page can reach a Drive write', () => {
  it('never mentions a write route from any browser file', () => {
    for (const page of pages) {
      for (const route of WRITE_ROUTES) {
        expect(page.text, `${page.path} still calls ${route}`).not.toContain(route)
      }
    }
  })

  it('has no upload control on the Files page — not even a hidden file input', () => {
    for (const page of filesPage) {
      expect(page.text, page.path).not.toMatch(/type="file"/)
      expect(page.text, page.path).not.toMatch(/FormData\(/)
    }
  })

  it('has no drop zone on the Files page — a dropped file must do nothing', () => {
    for (const page of filesPage) {
      expect(page.text, page.path).not.toMatch(/onDrop\b/)
      expect(page.text, page.path).not.toMatch(/onDragOver/)
      expect(page.text, page.path).not.toMatch(/dataTransfer/)
      expect(page.text, page.path).not.toMatch(/draggable/)
    }
  })

  it('sends no confirmation flag, because there is nothing to confirm', () => {
    expect(paths(pages.filter(f => /confirm:\s*true/.test(f.text)))).toEqual([])
  })

  it('the Files page keeps only the two read actions it can honour', () => {
    const panel = filesPage.find(f => f.path.endsWith('FilesPanel.tsx'))!.text
    expect(panel).toContain('/api/drive/download')
    expect(panel).toContain('Open in Drive')
    for (const gone of ['Rename', 'Move…', 'Get a link']) {
      expect(panel, `the panel still offers ${gone}`).not.toContain(gone)
    }
  })
})

describe('every write route refuses before it does anything', () => {
  const writeRouteFiles = routes.filter(f => WRITE_ROUTES.some(r => f.path.includes(r.replace('/api/drive', 'app/api/drive'))))

  it('finds all six of them', () => {
    expect(writeRouteFiles).toHaveLength(WRITE_ROUTES.length)
  })

  it('calls readOnlyRefusal FIRST — before the role check and before the body', () => {
    for (const file of writeRouteFiles) {
      const refusal = file.text.indexOf('readOnlyRefusal()')
      const role = file.text.indexOf('requireFilesAccess()')
      const body = file.text.indexOf('req.json()')
      expect(refusal, `${file.path} has no read-only guard`).toBeGreaterThan(-1)
      expect(refusal, `${file.path} checks the role first`).toBeLessThan(role)
      if (body > -1) expect(refusal, `${file.path} reads the body first`).toBeLessThan(body)
    }
  })
})

describe('only a confirmed Move re-parents anything, if it ever runs at all', () => {
  it('has exactly one file that can change a file’s folder', () => {
    expect(paths(sources.filter(f => /moveDriveFile|addParents|removeParents/.test(f.text))))
      .toEqual(['app/api/drive/move/route.ts'])
  })

  it('and that file refuses BEFORE the write, not after it', () => {
    const route = code(readFileSync('app/api/drive/move/route.ts', 'utf8'))
    const readOnly = route.indexOf('readOnlyRefusal()')
    const refusal = route.indexOf('confirmRefusal(')
    const contained = route.indexOf('outsideHqRefusal(')
    const write = route.indexOf('await moveDriveFile(')
    for (const [name, at] of [['read-only', readOnly], ['confirm', refusal], ['containment', contained]] as const) {
      expect(at, `move route has no ${name} gate`).toBeGreaterThan(-1)
      expect(at, `${name} gate runs after the write`).toBeLessThan(write)
    }
  })

  it('keeps every write inside the folder the owner chose', () => {
    for (const path of [
      'app/api/drive/move/route.ts',
      'app/api/drive/folder/route.ts',
      'app/api/drive/upload/start/route.ts',
    ]) {
      const route = code(readFileSync(path, 'utf8'))
      expect(route, `${path} does not check containment`).toContain('outsideHqRefusal(')
    }
  })
})

describe('nothing anywhere deletes anything', () => {
  it('has no delete or trash route', () => {
    const names = readdirSync('app/api/drive')
    expect(names).not.toContain('delete')
    expect(names).not.toContain('trash')
  })

  it('never asks Drive to trash a file', () => {
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

describe('the folder picker adopts and never creates', () => {
  const picker = code(readFileSync('app/lib/gdrive-root.ts', 'utf8'))

  it('makes no folder in the owner’s Drive, in the plan or in Apply', () => {
    expect(picker).not.toMatch(/createSubfolder\s*\(/)
    expect(picker).not.toMatch(/ensureFolder\s*\(/)
  })

  it('and shares nothing either', () => {
    expect(picker).not.toMatch(/shareWithDomain\s*\(/)
  })

  it('the hook fallback adopts by name and creates nothing', () => {
    const gdrive = code(readFileSync('app/lib/gdrive.ts', 'utf8'))
    const from = gdrive.indexOf('async function adoptClientFolder')
    expect(from).toBeGreaterThan(-1)
    const body = gdrive.slice(from, gdrive.indexOf('export async function ensureClientChain'))
    expect(body).not.toMatch(/createSubfolder\s*\(|createFolder\s*\(/)
  })
})
