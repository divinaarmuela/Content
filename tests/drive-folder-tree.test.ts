import { describe, expect, it } from 'vitest'
import { baseName, startOpenFolders, tileTree } from '../app/lib/drive-folder-files-core'

/**
 * THE FOLDERS INSIDE A HANDED-IN LINK (19 Oct 2026, Ryan Patumaka's "Travel Vlogs x5"): 37 pulled files, their
 * folders kept in their names, drawn as one grid. The tree puts them back where they came from.
 */
describe('tileTree', () => {
  const names = [
    'SCHEDULED/Video Carousel/1.mov', 'SCHEDULED/Video Carousel/10.mov', 'SCHEDULED/Video Carousel/2.mov',
    'SCHEDULED/Video Carousel 2/1.mp4', 'SCHEDULED/Alia Trendy.mp4', 'SCHEDULED/Travel Vlog August.mp4',
  ].map((name, i) => ({ id: String(i), name }))

  it('groups files back into the folders they came from', () => {
    const top = tileTree(names)
    expect(top.count).toBe(6)
    expect(top.files).toHaveLength(0)
    const scheduled = top.folders[0]
    expect(scheduled.path).toBe('SCHEDULED')
    expect(scheduled.files.map(f => baseName(f.name))).toEqual(['Alia Trendy.mp4', 'Travel Vlog August.mp4'])
    expect(scheduled.folders.map(f => [f.name, f.count])).toEqual([['Video Carousel', 3], ['Video Carousel 2', 1]])
    expect(scheduled.folders[0].path).toBe('SCHEDULED/Video Carousel')
  })

  it('leaves a set with no folders as one flat level', () => {
    const top = tileTree([{ name: 'a.mp4' }, { name: 'b.mp4' }])
    expect(top.folders).toHaveLength(0)
    expect(top.files).toHaveLength(2)
  })

  it('opens a lone wrapping folder by itself, and nothing below where the files divide', () => {
    expect([...startOpenFolders(tileTree(names))]).toEqual(['SCHEDULED'])
    expect([...startOpenFolders(tileTree([{ name: 'a.mp4' }, { name: 'X/b.mp4' }]))]).toEqual([])
  })

  it('names a file without its folders', () => {
    expect(baseName('SCHEDULED/Video Carousel/1.mov')).toBe('1.mov')
    expect(baseName('plain.mp4')).toBe('plain.mp4')
  })
})

import { folderSections } from '../app/lib/drive-folder-files-core'

describe('folderSections — the portal headings', () => {
  const ryan = [
    'SCHEDULED/Video Carousel/1.mov', 'SCHEDULED/Video Carousel/2.mov', 'SCHEDULED/Video Carousel 2/1.mp4',
    'SCHEDULED/Alia Trendy.mp4', 'SCHEDULED/Video Carousel 2/Extra/x.mp4',
  ].map(name => ({ name }))

  it('one heading per folder, by its whole name as in Drive', () => {
    expect(folderSections(ryan).map(s => [s.title, s.files.length])).toEqual([
      ['SCHEDULED', 1], ['SCHEDULED / Video Carousel', 2], ['SCHEDULED / Video Carousel 2', 1], ['SCHEDULED / Video Carousel 2 / Extra', 1],
    ])
  })

  it('no folders, no headings', () => {
    expect(folderSections([{ name: 'a.mp4' }, { name: 'b.mp4' }])).toEqual([{ title: null, path: '', files: [{ name: 'a.mp4' }, { name: 'b.mp4' }] }])
  })

  it('loose files beside folders come first, under their own heading', () => {
    expect(folderSections([{ name: 'X/a.mp4' }, { name: 'b.mp4' }]).map(s => s.title)).toEqual(['In the main folder', 'X'])
  })
})

import { handoverNotice, waitsInFolders } from '../app/lib/post-batch-core'

describe('a hand-over of files in folders', () => {
  it('waits in the rail when the files sit in two or more folders, the main one counting', () => {
    expect(waitsInFolders([{ name: 'SCHEDULED/Video Carousel/1.mov' }, { name: 'SCHEDULED/Alia.mp4' }])).toBe(true)
    expect(waitsInFolders([{ name: 'X/a.mp4' }, { name: 'b.mp4' }])).toBe(true)
  })
  it('hands over as before when everything is in one folder, or none (The Glass Den "6-12/")', () => {
    expect(waitsInFolders([{ name: '6-12/GLASS DEN - MORNINGS.mov' }, { name: '6-12/GLASS DEN - BRUNCH.mov' }])).toBe(false)
    expect(waitsInFolders([{ name: 'a.mp4' }, { name: 'b.mp4' }])).toBe(false)
  })
  it('says where the files went', () => {
    expect(handoverNotice('Test Scheduler', 0, true)).toBe('Handed to Test Scheduler — the files wait on the Schedule page, folder by folder, to post any time.')
    expect(handoverNotice('Test Scheduler', 3)).toBe('Handed to Test Scheduler — 3 draft posts on Post approval')
  })
})

import { SCHEDULING_HAND_TO_ORDER, handToGroups } from '../app/lib/hand-over-core'

describe('who a card is handed to for posting', () => {
  it('schedulers first, then super admins, then account managers', () => {
    const people = [
      { id: 'a', name: 'Amy', role: 'account_manager' }, { id: 's', name: 'Sam', role: 'scheduler' },
      { id: 'd', name: 'Divina', role: 'super_admin' },
    ]
    expect(handToGroups(people as never, SCHEDULING_HAND_TO_ORDER).map(g => g.role)).toEqual(['scheduler', 'super_admin', 'account_manager'])
  })
})
