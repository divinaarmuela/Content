'use client'

/**
 * THE DRIVE COPIES THIS BROWSER IS WATCHING (the owner, 30 Sep 2026: the progress tray "must also show a Drive
 * hand-in's background copy progress, like uploads did"). A Drive hand-in's bytes move on the server (the
 * drive-pull-folder job), so there is nothing to upload here — only a row to watch. Each hand-in started from this
 * browser is remembered (in localStorage, so a reload keeps it) until it is dismissed; the tray reads the pull row
 * and the card live and says "Copying 2 of 4 from Google Drive…", then done or what stopped it.
 */
export type DriveCopyWatch = { pullId: string; handInId: string; itemId: string; title: string }

const KEY = 'mdm-drive-copies'
let watches: DriveCopyWatch[] = load()
const listeners = new Set<() => void>()

function load(): DriveCopyWatch[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((w): w is DriveCopyWatch => !!w && typeof w.pullId === 'string' && typeof w.handInId === 'string' && typeof w.itemId === 'string').slice(-10) : []
  } catch { return [] }
}

function save(next: DriveCopyWatch[]) {
  watches = next
  try { window.localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* a private window: this tab still shows it */ }
  for (const l of listeners) l()
}

export function subscribeDriveCopies(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function getDriveCopies(): DriveCopyWatch[] {
  return watches
}

const NONE: DriveCopyWatch[] = []
export function getNoDriveCopies(): DriveCopyWatch[] {
  return NONE
}

export function watchDriveCopy(w: DriveCopyWatch): void {
  save([...watches.filter(x => x.handInId !== w.handInId), w].slice(-10))
}

export function dismissDriveCopy(handInId: string): void {
  save(watches.filter(x => x.handInId !== handInId))
}
