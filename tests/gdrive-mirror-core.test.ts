import { describe, it, expect } from 'vitest'
import {
  CHUNK_MULTIPLE, CHUNK_SIZE, contentRange, earliestScheduledMonth,
  emailDomain, fileNameFromUrl, isClientTarget, isMirrorTarget, isMirrorableUrl,
  isTestAddress, memberPermissionDiff, membersNeedingPermission, mirrorKey,
  mirrorProgress, misfiledRawMirrors, missingItemMirrors, receivedBytes,
  sharingSummary, statusRange, versionFileName, wantedItemFiles,
  type DriveFileRow, type SweepItem,
} from '../app/lib/gdrive-mirror-core'
import {
  FROM_CLIENT_FOLDER, NO_SHOOT_FINAL_FOLDER, NO_SHOOT_RAW_FOLDER, RAW_FOLDER,
  SCHEDULED_FOLDER, dayStamp, fromClientChain, intakeFileTarget,
  noShootFinalChain, noShootRawChain, scheduledChain, shootFinalChain,
  shootRawChain,
} from '../app/lib/gdrive-core'

describe('isMirrorableUrl', () => {
  it('mirrors a file on our own storage', () => {
    expect(isMirrorableUrl('https://media.mdmmarketing.com.au/1755043200000-k3f9a1-hook.mp4')).toBe(true)
    expect(isMirrorableUrl('https://pub-abc.r2.dev/1755043200000-k3f9a1-hook.mp4')).toBe(true)
    expect(isMirrorableUrl('https://pub-813c3e66befd45a9abcb40de26c719f2.r2.dev/website-assets/a.png')).toBe(true)
  })

  it('never mirrors a pasted link — there is no file of ours behind it', () => {
    // downloading one of these stores an HTML page under a video's name
    expect(isMirrorableUrl('https://drive.google.com/drive/folders/abc')).toBe(false)
    expect(isMirrorableUrl('https://docs.google.com/document/d/abc/edit')).toBe(false)
    expect(isMirrorableUrl('https://www.youtube.com/watch?v=abc')).toBe(false)
    expect(isMirrorableUrl('https://youtu.be/abc')).toBe(false)
    expect(isMirrorableUrl('https://vimeo.com/12345')).toBe(false)
    expect(isMirrorableUrl('https://www.dropbox.com/s/abc/file.mp4')).toBe(false)
    expect(isMirrorableUrl('https://app.frame.io/reviews/abc')).toBe(false)
  })

  it('refuses anything that is not an https URL', () => {
    expect(isMirrorableUrl('')).toBe(false)
    expect(isMirrorableUrl(null)).toBe(false)
    expect(isMirrorableUrl(undefined)).toBe(false)
    expect(isMirrorableUrl('http://insecure.example/a.mp4')).toBe(false)
    expect(isMirrorableUrl('not a url')).toBe(false)
    expect(isMirrorableUrl('javascript:alert(1)')).toBe(false)
  })

  it('matches subdomains of a link host, not merely suffixes of its name', () => {
    expect(isMirrorableUrl('https://cdn.vimeo.com/x.mp4')).toBe(false)
    // "notyoutube.com" is a different company, not a YouTube subdomain
    expect(isMirrorableUrl('https://notyoutube.com/x.mp4')).toBe(true)
  })
})

describe('fileNameFromUrl', () => {
  it('takes our own collision prefix back off', () => {
    expect(fileNameFromUrl('https://cdn.example/1755043200000-k3f9a1-Hook_cut.mp4'))
      .toBe('Hook_cut.mp4')
  })

  it('leaves a name that merely contains digits and dashes alone', () => {
    expect(fileNameFromUrl('https://cdn.example/2026-08-hero-shot.jpg'))
      .toBe('2026-08-hero-shot.jpg')
  })

  it('decodes what the URL escaped', () => {
    expect(fileNameFromUrl('https://cdn.example/Reel%2001%20-%20final.mov'))
      .toBe('Reel 01 - final.mov')
  })

  it('drops the query string with the path', () => {
    expect(fileNameFromUrl('https://cdn.example/a/b/clip.mp4?token=xyz')).toBe('clip.mp4')
  })

  it('always answers with something openable', () => {
    expect(fileNameFromUrl('https://cdn.example/')).toBe('file')
    expect(fileNameFromUrl('')).toBe('file')
    expect(fileNameFromUrl(null)).toBe('file')
  })

  it('never lets a decoded slash invent a folder level', () => {
    expect(fileNameFromUrl('https://cdn.example/a%2Fb.mp4')).toBe('ab.mp4')
  })
})

describe('versionFileName', () => {
  it('leads with the version so the folder sorts in cut order', () => {
    expect(versionFileName(3, 'Hook cut.mp4')).toBe('v3 - Hook cut.mp4')
  })

  it('keeps the editor name, because v3 alone says nothing', () => {
    expect(versionFileName(1, 'Spring campaign - reel 02.mov'))
      .toBe('v1 - Spring campaign - reel 02.mov')
  })

  it('never produces v0 or vNaN', () => {
    expect(versionFileName(0, 'a.mp4')).toBe('v1 - a.mp4')
    expect(versionFileName(-4, 'a.mp4')).toBe('v1 - a.mp4')
    expect(versionFileName(Number.NaN, 'a.mp4')).toBe('v1 - a.mp4')
    expect(versionFileName(2.7, 'a.mp4')).toBe('v2 - a.mp4')
  })

  it('falls back to a name rather than a trailing dash', () => {
    expect(versionFileName(2, '')).toBe('v2 - file')
    expect(versionFileName(2, null)).toBe('v2 - file')
  })
})

describe('earliestScheduledMonth', () => {
  it('files the piece under the month it FIRST goes out', () => {
    // a fortnight of posts straddling a month boundary is one file, in one
    // month, and it is the month everyone thinks of it as
    expect(earliestScheduledMonth([
      { scheduled_at: '2026-09-02T09:00:00Z' },
      { scheduled_at: '2026-08-28T09:00:00Z' },
      { scheduled_at: '2026-09-10T09:00:00Z' },
    ])).toBe('2026-08')
  })

  it('ignores platforms with no date — they have not voted yet', () => {
    expect(earliestScheduledMonth([
      { scheduled_at: null },
      { scheduled_at: '2026-11-04T00:00:00Z' },
      { scheduled_at: '' },
    ])).toBe('2026-11')
  })

  it('has no month when nothing is dated', () => {
    expect(earliestScheduledMonth([])).toBeNull()
    expect(earliestScheduledMonth([{ scheduled_at: null }])).toBeNull()
    expect(earliestScheduledMonth(null)).toBeNull()
    expect(earliestScheduledMonth([{ scheduled_at: 'soon' }])).toBeNull()
  })

  it('pads a single-digit month', () => {
    expect(earliestScheduledMonth([{ scheduled_at: '2027-01-05T00:00:00Z' }])).toBe('2027-01')
  })
})

describe('scheduledChain / final chains', () => {
  it('puts the month under the client, not under a shoot', () => {
    expect(scheduledChain('Nathan Homes', '2026-09'))
      .toEqual(['Nathan Homes', SCHEDULED_FOLDER, '2026-09'])
  })

  it('sends a shoot item to the shoot it came from', () => {
    expect(shootFinalChain('Nathan Homes', '2026-08 Spring Campaign'))
      .toEqual(['Nathan Homes', '2026-08 Spring Campaign', '03 Final'])
  })

  it('gives a shoot-less item its own Final, not a number counting nothing', () => {
    expect(noShootFinalChain('Nathan Homes', 'Reel 01 - Hook'))
      .toEqual(['Nathan Homes', '_No shoot', 'Reel 01 - Hook', NO_SHOOT_FINAL_FOLDER])
    expect(NO_SHOOT_FINAL_FOLDER).toBe('Final')
  })

  it('reads the client name exactly as every other chain does', () => {
    // `chain` splits on `/`, so a slashed client name becomes two levels
    // here just as it does in clientChain — one client, one folder, whichever
    // chain built it
    expect(scheduledChain('A/B Testing Co', '2026-09'))
      .toEqual(['A', 'B Testing Co', SCHEDULED_FOLDER, '2026-09'])
    expect(scheduledChain('  Nathan  Homes  ', '2026-09'))
      .toEqual(['Nathan Homes', SCHEDULED_FOLDER, '2026-09'])
  })
})

describe('fromClientChain / dayStamp', () => {
  it('files a delivery by the DAY it arrived', () => {
    expect(fromClientChain('Nathan Homes', '2026-08-27'))
      .toEqual(['Nathan Homes', FROM_CLIENT_FOLDER, '2026-08-27'])
    expect(FROM_CLIENT_FOLDER).toBe('_From client')
  })

  it('reads a day off a date or a timestamp', () => {
    expect(dayStamp('2026-08-27')).toBe('2026-08-27')
    expect(dayStamp('2026-08-27T23:14:02.000Z')).toBe('2026-08-27')
    expect(dayStamp('2026-08-27T00:00:00.000Z')).toBe('2026-08-27')
  })

  it('has no day for a non-date', () => {
    expect(dayStamp(null)).toBeNull()
    expect(dayStamp('')).toBeNull()
    expect(dayStamp('whenever')).toBeNull()
  })
})

describe('intakeFileTarget', () => {
  it('sends brand material to _Brand, wherever it came from', () => {
    // the template's own file block, verbatim
    expect(intakeFileTarget('brand_files', 'Logo files, brand colours and fonts'))
      .toBe('brand')
    expect(intakeFileTarget('logo_upload')).toBe('brand')
    expect(intakeFileTarget('assets', 'Your style guide')).toBe('brand')
    expect(intakeFileTarget('x', 'Brand guidelines PDF')).toBe('brand')
  })

  it('sends everything else to _From client', () => {
    expect(intakeFileTarget('premises_photos', 'Photos of your premises'))
      .toBe('from_client')
    expect(intakeFileTarget('existing_content', 'Anything you have already shot'))
      .toBe('from_client')
    expect(intakeFileTarget(null)).toBe('from_client')
  })

  it('reads the QUESTION, not the file name', () => {
    // logo.png uploaded against "photos of your premises" is a photo of a sign
    expect(intakeFileTarget('premises_photos', 'Photos of your premises'))
      .toBe('from_client')
  })

  it('does not fire on a word that merely contains one of the terms', () => {
    expect(intakeFileTarget('brandenburg_tour', 'Brandenburg tour footage'))
      .toBe('from_client')
    expect(intakeFileTarget('fontaine_shoot', 'Fontaine cafe shoot')).toBe('from_client')
  })

  it('reads an underscored block id as separate words', () => {
    // regex word boundaries treat `_` as a letter; `logo_upload` is a logo
    expect(intakeFileTarget('logo_upload')).toBe('brand')
    expect(intakeFileTarget('brand-guidelines')).toBe('brand')
  })
})

describe('where raw footage goes', () => {
  it('files a shoot’s footage in the SHOOT’s 01 Raw, not in any item folder', () => {
    // `02 Edits/{Item}` is the bench — what the editor MADE. Source material
    // dropped in beside the cuts is the bug this target exists to fix, and it
    // also hid the day's footage from every other item cut from the shoot.
    expect(shootRawChain('Stretchworks', '2026-08 Monday Martin Shoot'))
      .toEqual(['Stretchworks', '2026-08 Monday Martin Shoot', RAW_FOLDER])
    expect(RAW_FOLDER).toBe('01 Raw')
  })

  it('gives a shoot-less item its own Raw subfolder, unnumbered', () => {
    // no shoot means no stages for `01`/`02`/`03` to order — but the footage
    // still must not share a folder with the cuts made from it
    expect(noShootRawChain('Stretchworks', 'Reel 01 - Hook'))
      .toEqual(['Stretchworks', '_No shoot', 'Reel 01 - Hook', NO_SHOOT_RAW_FOLDER])
    expect(NO_SHOOT_RAW_FOLDER).toBe('Raw')
  })

  it('is a real target, and one that belongs to a piece of work', () => {
    expect(isMirrorTarget('raw')).toBe(true)
    expect(isClientTarget('raw')).toBe(false)
  })

  it('keys a mirrored copy by the PAIR, since one URL can be two rows', () => {
    expect(mirrorKey('raw', 'https://x/a.jpg'))
      .not.toBe(mirrorKey('item', 'https://x/a.jpg'))
  })
})

describe('client-scoped targets', () => {
  it('knows which targets belong to a client rather than a piece of work', () => {
    expect(isClientTarget('brand')).toBe(true)
    expect(isClientTarget('from_client')).toBe(true)
    expect(isClientTarget('item')).toBe(false)
    expect(isClientTarget('final')).toBe(false)
    expect(isClientTarget('scheduled')).toBe(false)
  })

  it('accepts them as real targets on an event', () => {
    expect(isMirrorTarget('brand')).toBe(true)
    expect(isMirrorTarget('from_client')).toBe(true)
  })
})

describe('isTestAddress', () => {
  it('recognises the reserved test domain the suite uses', () => {
    expect(isTestAddress('editor@example.invalid')).toBe(true)
    expect(isTestAddress('ZZ.TEST@md.invalid')).toBe(true)
  })
  it('does not flag a real address', () => {
    expect(isTestAddress('nathan@mdmmarketing.com.au')).toBe(false)
    expect(isTestAddress('a@invalid.com')).toBe(false)
    expect(isTestAddress(null)).toBe(false)
  })
})

describe('emailDomain', () => {
  it('reads the domain, lowercased', () => {
    expect(emailDomain('Nathan@MDMMarketing.com.au')).toBe('mdmmarketing.com.au')
  })
  it('has no answer for a non-address', () => {
    expect(emailDomain('nathan')).toBeNull()
    expect(emailDomain('a@b@c')).toBeNull()
    expect(emailDomain(null)).toBeNull()
  })
})

describe('membersNeedingPermission', () => {
  const domain = 'mdmmarketing.com.au'
  const team = [
    { email: 'nathan@mdmmarketing.com.au', role: 'super_admin', active_status: true },
    { email: 'freelance.editor@gmail.com', role: 'editor', active_status: true },
    { email: 'Contractor@Hotmail.com', role: 'scheduler', active_status: true },
    { email: 'left@gmail.com', role: 'editor', active_status: false },
    { email: 'theclient@bigco.com', role: 'client', active_status: true },
    { email: 'test.editor@example.invalid', role: 'editor', active_status: true },
  ]

  it('grants only to the people the domain share does not already cover', () => {
    expect(membersNeedingPermission(team, {
      sharingDomain: domain, accountEmail: 'nathan@mdmmarketing.com.au',
    })).toEqual(['contractor@hotmail.com', 'freelance.editor@gmail.com'])
  })

  it('never grants to a client — the root holds every client’s footage', () => {
    const out = membersNeedingPermission(team, { sharingDomain: domain })
    expect(out).not.toContain('theclient@bigco.com')
  })

  it('never grants to a .invalid test address', () => {
    const out = membersNeedingPermission(team, { sharingDomain: null })
    expect(out.some(isTestAddress)).toBe(false)
  })

  it('skips people who have left', () => {
    expect(membersNeedingPermission(team, { sharingDomain: domain }))
      .not.toContain('left@gmail.com')
  })

  it('grants to EVERYONE when the owner is a personal account', () => {
    // no domain share exists at all, so nobody is covered by default
    expect(membersNeedingPermission(team, {
      sharingDomain: null, accountEmail: 'owner@gmail.com',
    })).toEqual([
      'contractor@hotmail.com', 'freelance.editor@gmail.com',
      'nathan@mdmmarketing.com.au',
    ])
  })

  it('never grants the owner a permission on their own folder', () => {
    expect(membersNeedingPermission(
      [{ email: 'owner@gmail.com', role: 'super_admin', active_status: true }],
      { sharingDomain: null, accountEmail: 'Owner@Gmail.com' },
    )).toEqual([])
  })

  it('drops malformed addresses and de-duplicates', () => {
    expect(membersNeedingPermission([
      { email: 'not-an-email', role: 'editor', active_status: true },
      { email: '', role: 'editor', active_status: true },
      { email: 'a@b.com', role: 'editor', active_status: true },
      { email: 'A@B.com', role: 'scheduler', active_status: true },
    ], { sharingDomain: null })).toEqual(['a@b.com'])
  })

  it('treats a member with no active flag as active', () => {
    expect(membersNeedingPermission(
      [{ email: 'a@b.com', role: 'editor' }], { sharingDomain: null },
    )).toEqual(['a@b.com'])
  })
})

describe('memberPermissionDiff', () => {
  it('adds who is missing and removes who left', () => {
    const diff = memberPermissionDiff(
      ['new@gmail.com', 'stays@gmail.com'],
      [
        { id: 'p1', emailAddress: 'stays@gmail.com', type: 'user', role: 'writer' },
        { id: 'p2', emailAddress: 'gone@gmail.com', type: 'user', role: 'writer' },
      ],
    )
    expect(diff.add).toEqual(['new@gmail.com'])
    expect(diff.remove).toEqual([{ id: 'p2', email: 'gone@gmail.com' }])
    expect(diff.keep).toEqual(['stays@gmail.com'])
  })

  it('is idempotent — a second run changes nothing', () => {
    const existing = [{ id: 'p1', emailAddress: 'a@gmail.com', type: 'user', role: 'writer' }]
    const diff = memberPermissionDiff(['a@gmail.com'], existing)
    expect(diff.add).toEqual([])
    expect(diff.remove).toEqual([])
  })

  it('never touches the owner', () => {
    const diff = memberPermissionDiff([], [
      { id: 'own', emailAddress: 'owner@gmail.com', type: 'user', role: 'owner' },
    ])
    expect(diff.remove).toEqual([])
  })

  it('leaves the domain grant completely alone', () => {
    // it is the thing covering everyone this function chose not to grant
    const diff = memberPermissionDiff([], [
      { id: 'd1', type: 'domain', role: 'writer' },
      { id: 'a1', type: 'anyone', role: 'reader' },
    ])
    expect(diff.remove).toEqual([])
  })

  it('compares addresses case-insensitively', () => {
    const diff = memberPermissionDiff(['A@Gmail.com'], [
      { id: 'p1', emailAddress: 'a@gmail.com', type: 'user', role: 'writer' },
    ])
    expect(diff.add).toEqual([])
    expect(diff.remove).toEqual([])
  })

  it('cleans up a duplicate grant for someone who should stay', () => {
    const diff = memberPermissionDiff(['a@gmail.com'], [
      { id: 'p1', emailAddress: 'a@gmail.com', type: 'user', role: 'writer' },
      { id: 'p2', emailAddress: 'a@gmail.com', type: 'user', role: 'reader' },
    ])
    expect(diff.add).toEqual([])
    expect(diff.remove).toEqual([{ id: 'p2', email: 'a@gmail.com' }])
    expect(diff.keep).toEqual(['a@gmail.com'])
  })

  it('ignores a permission with no id or no address', () => {
    const diff = memberPermissionDiff([], [
      { id: '', emailAddress: 'a@gmail.com', type: 'user', role: 'writer' },
      { id: 'p2', emailAddress: null, type: 'user', role: 'writer' },
    ])
    expect(diff.remove).toEqual([])
  })

  it('handles an empty live list', () => {
    expect(memberPermissionDiff(['a@gmail.com'], null).add).toEqual(['a@gmail.com'])
  })
})

describe('sharingSummary', () => {
  it('names the domain and counts the extras', () => {
    expect(sharingSummary('mdmmarketing.com.au', 2))
      .toBe('Shared with mdmmarketing.com.au + 2 personal accounts.')
    expect(sharingSummary('mdmmarketing.com.au', 1))
      .toBe('Shared with mdmmarketing.com.au + 1 personal account.')
    expect(sharingSummary('mdmmarketing.com.au', 0))
      .toBe('Shared with everyone at mdmmarketing.com.au.')
  })

  it('says the plain truth for a personal account with nobody added', () => {
    expect(sharingSummary(null, 0)).toContain('Not shared with anyone yet')
    expect(sharingSummary(null, 3)).toBe('Shared with 3 personal accounts.')
  })
})

describe('mirrorProgress', () => {
  it('says nothing at all when there is nothing to mirror', () => {
    expect(mirrorProgress(0, 0).line).toBeNull()
  })

  it('reports the finished count', () => {
    expect(mirrorProgress(7, 7).line).toBe('Mirrored to Drive · 7 files')
    expect(mirrorProgress(1, 1).line).toBe('Mirrored to Drive · 1 file')
  })

  it('says where the raw files went, because they are not in the folder', () => {
    // today's case: four files on the item, three of them raw footage that
    // now lives in the shoot's `01 Raw` rather than beside the cuts
    expect(mirrorProgress(4, 4, 3).line)
      .toBe('Mirrored to Drive · 4 files (3 raw in 01 Raw)')
    // a shoot-less deliverable keeps its footage in its own unnumbered `Raw`
    expect(mirrorProgress(2, 2, 1, NO_SHOOT_RAW_FOLDER).line)
      .toBe('Mirrored to Drive · 2 files (1 raw in Raw)')
  })

  it('says nothing about raw when there is none, and counts none while copying', () => {
    expect(mirrorProgress(4, 4, 0).line).toBe('Mirrored to Drive · 4 files')
    expect(mirrorProgress(4, 2, 2).line).toBe('Copying to Drive… 2 of 4')
    // a raw count can never exceed what is actually done
    expect(mirrorProgress(4, 4, 9).raw).toBe(4)
  })

  it('reads as still copying while anything is outstanding', () => {
    // true whether the job is running, queued, or quietly failed
    const p = mirrorProgress(7, 5)
    expect(p.copying).toBe(true)
    expect(p.line).toBe('Copying to Drive… 5 of 7')
  })

  it('never reports more done than exist', () => {
    expect(mirrorProgress(2, 9)).toMatchObject({ total: 2, done: 2, copying: false })
  })
})

describe('isMirrorTarget', () => {
  it('accepts the three real targets and nothing else', () => {
    expect(isMirrorTarget('item')).toBe(true)
    expect(isMirrorTarget('final')).toBe(true)
    expect(isMirrorTarget('scheduled')).toBe(true)
    expect(isMirrorTarget('archive')).toBe(false)
    expect(isMirrorTarget(null)).toBe(false)
  })
})

describe('resumable upload arithmetic', () => {
  it('keeps every chunk a multiple of 256 KB, as Drive requires', () => {
    expect(CHUNK_MULTIPLE).toBe(262144)
    expect(CHUNK_SIZE % CHUNK_MULTIPLE).toBe(0)
  })

  it('writes an INCLUSIVE end in Content-Range', () => {
    expect(contentRange(0, 8388608, 2000000000)).toBe('bytes 0-8388607/2000000000')
    expect(contentRange(8388608, 10000000, 10000000)).toBe('bytes 8388608-9999999/10000000')
  })

  it('probes with a star for the part it is not sending', () => {
    expect(statusRange(2000000000)).toBe('bytes */2000000000')
  })

  it('reads a 308 Range as what IS there, not where to go next', () => {
    // bytes=0-42 means 43 bytes are in, so the next one is byte 43
    expect(receivedBytes('bytes=0-42')).toBe(43)
    expect(receivedBytes('bytes=0-262143')).toBe(262144)
  })

  it('treats a missing Range as nothing received', () => {
    expect(receivedBytes(null)).toBe(0)
    expect(receivedBytes('')).toBe(0)
    expect(receivedBytes('nonsense')).toBe(0)
  })
})

describe('the self-healing sweep — what should be in Drive and is not', () => {
  const u = (n: string) => `https://media.mdmmarketing.com.au/1755043200000-k3f9a1-${n}`

  const item = (over: Partial<SweepItem> = {}): SweepItem => ({
    id: 'item-1',
    raw_assets: [{ url: u('shoot-01.mov'), name: 'Shoot 01.mov' }],
    versions: [{ version_number: 1, file_url: u('cut.mp4'), files: [] }],
    ...over,
  })

  it('wants the job pack and every slide of every version', () => {
    const files = wantedItemFiles(item({
      versions: [
        { version_number: 1, file_url: u('v1.mp4'), files: [] },
        {
          version_number: 2,
          file_url: u('a.jpg'),
          files: [{ url: u('a.jpg'), name: 'a.jpg' }, { url: u('b.jpg'), name: 'b.jpg' }],
        },
      ],
    }))
    expect(files.map(f => f.name)).toEqual([
      'Shoot 01.mov', 'v1 - v1.mp4', 'v2 - 01 - a.jpg', 'v2 - 02 - b.jpg',
    ])
    // the job pack to `01 Raw`, the cuts to the item's own folder — and
    // nothing to finals or a month, which are decided by approving and
    // scheduling and never by a repair pass
    expect(files.map(f => f.target)).toEqual(['raw', 'item', 'item', 'item'])
    expect([...new Set(files.map(f => f.item_id))]).toEqual(['item-1'])
  })

  it('names files exactly as the live upload paths name them', () => {
    // a sweep with a naming scheme of its own would fill the folder with
    // second copies the first time it ran
    const [asset] = wantedItemFiles(item({ raw_assets: [{ url: u('clip.mov'), name: '' }], versions: [] }))
    expect(asset.name).toBe(fileNameFromUrl(u('clip.mov')))
    const [single] = wantedItemFiles(item({
      raw_assets: [], versions: [{ version_number: 3, file_url: u('hook.mp4'), files: [] }],
    }))
    expect(single.name).toBe(versionFileName(3, 'hook.mp4'))
  })

  it('never wants a pasted link — there are no bytes of ours to copy', () => {
    const files = wantedItemFiles(item({
      raw_assets: [{ url: 'https://drive.google.com/file/d/abc', name: 'brief' }],
      versions: [{ version_number: 1, file_url: 'https://youtu.be/abc', files: [] }],
    }))
    expect(files).toEqual([])
  })

  it('subtracts what Drive already holds', () => {
    const missing = missingItemMirrors([item()], [mirrorKey('raw', u('shoot-01.mov'))])
    expect(missing.map(f => f.source_url)).toEqual([u('cut.mp4')])
  })

  it('finds nothing when everything is there — the normal case', () => {
    expect(missingItemMirrors([item()], [
      mirrorKey('raw', u('shoot-01.mov')), mirrorKey('item', u('cut.mp4')),
    ])).toEqual([])
  })

  it('does not count a raw copy as the edits copy, or the other way round', () => {
    // the same clip in `01 Raw` says nothing about whether the version cut
    // from it reached `02 Edits` — comparing bare URLs made one cancel the
    // other and left a folder permanently one file short
    const both = item({
      raw_assets: [{ url: u('a.jpg'), name: 'a.jpg' }],
      versions: [{ version_number: 1, file_url: u('a.jpg'), files: [] }],
    })
    expect(missingItemMirrors([both], []).map(f => f.target)).toEqual(['raw', 'item'])
    expect(missingItemMirrors([both], [mirrorKey('raw', u('a.jpg'))])
      .map(f => f.target)).toEqual(['item'])
  })

  it('asks again for a claim whose upload died', () => {
    // the caller only passes rows WITH a drive_file_id, so a half-finished
    // claim is absent from `mirrored` and comes back into the answer — which
    // is the whole reason the claim is left behind
    expect(missingItemMirrors([item()], []).map(f => f.source_url))
      .toEqual([u('shoot-01.mov'), u('cut.mp4')])
  })

  it('asks for one file once per folder, however many versions carry it', () => {
    const missing = missingItemMirrors([item({
      raw_assets: [],
      versions: [
        { version_number: 1, file_url: u('a.jpg'), files: [] },
        { version_number: 2, file_url: u('a.jpg'), files: [] },
      ],
    })], [])
    expect(missing).toHaveLength(1)
  })

  it('caps a run, and the remainder is simply still missing next time', () => {
    const many = item({
      raw_assets: Array.from({ length: 30 }, (_, i) => ({ url: u(`f${i}.jpg`), name: `f${i}.jpg` })),
      versions: [],
    })
    expect(missingItemMirrors([many], [], 10)).toHaveLength(10)
    expect(missingItemMirrors([many], [], 0)).toEqual([])
    expect(missingItemMirrors([many], [])).toHaveLength(30)
  })

  it('sweeps across items, and shrugs at nothing at all', () => {
    const missing = missingItemMirrors(
      [item(), item({ id: 'item-2', raw_assets: [{ url: u('x.jpg'), name: 'x.jpg' }], versions: [] })],
      [mirrorKey('raw', u('shoot-01.mov')), mirrorKey('item', u('cut.mp4'))],
    )
    expect(missing).toEqual([
      { item_id: 'item-2', source_url: u('x.jpg'), name: 'x.jpg', target: 'raw' },
    ])
    expect(missingItemMirrors(null, [])).toEqual([])
    expect(missingItemMirrors([{ id: 'x' }], [])).toEqual([])
  })
})

describe('the raw files already in the wrong folder', () => {
  const u = (n: string) => `https://media.mdmmarketing.com.au/1755043200000-k3f9a1-${n}`

  // "May Shoot 05" as it actually is: three raw clips mirrored to `02 Edits`
  // back when `item` was the only target there was
  const item = (over: Partial<SweepItem> = {}): SweepItem => ({
    id: 'item-1',
    raw_assets: [
      { url: u('a.mov'), name: 'a.mov' },
      { url: u('b.mov'), name: 'b.mov' },
      { url: u('c.mov'), name: 'c.mov' },
    ],
    versions: [{ version_number: 1, file_url: u('cut.mp4'), files: [] }],
    ...over,
  })

  const row = (over: Partial<DriveFileRow> = {}): DriveFileRow => ({
    id: 'row-a', item_id: 'item-1', source_url: u('a.mov'),
    target: 'item', drive_file_id: 'gdrive-a',
    ...over,
  })

  it('finds every raw asset filed under the edits target', () => {
    const found = misfiledRawMirrors([item()], [
      row(),
      row({ id: 'row-b', source_url: u('b.mov'), drive_file_id: 'gdrive-b' }),
      row({ id: 'row-c', source_url: u('c.mov'), drive_file_id: 'gdrive-c' }),
      // the version's own file belongs in `02 Edits` and must stay
      row({ id: 'row-cut', source_url: u('cut.mp4'), drive_file_id: 'gdrive-cut' }),
    ])
    expect(found.map(f => f.drive_file_id)).toEqual(['gdrive-a', 'gdrive-b', 'gdrive-c'])
    expect(found[0]).toEqual({
      id: 'row-a', item_id: 'item-1', source_url: u('a.mov'), drive_file_id: 'gdrive-a',
    })
  })

  it('is idempotent — a row already rewritten is never looked at again', () => {
    expect(misfiledRawMirrors([item()], [row({ target: 'raw' })])).toEqual([])
    // and so are the copies that live in other folders by design
    expect(misfiledRawMirrors([item()], [
      row({ target: 'final' }), row({ target: 'scheduled' }),
    ])).toEqual([])
  })

  it('leaves a file that is BOTH raw footage and a version exactly where it is', () => {
    // an editor who uploads the client's clip back as v1 gives it two honest
    // homes; moving the edits copy would delete a version from the bench
    const both = item({
      raw_assets: [{ url: u('a.mov'), name: 'a.mov' }],
      versions: [{ version_number: 1, file_url: u('a.mov'), files: [] }],
    })
    expect(misfiledRawMirrors([both], [row()])).toEqual([])
  })

  it('never touches a claim whose upload died — there is no file to move', () => {
    expect(misfiledRawMirrors([item()], [row({ drive_file_id: null })])).toEqual([])
    expect(misfiledRawMirrors([item()], [row({ drive_file_id: '' })])).toEqual([])
  })

  it('only ever moves a file that is on THAT item’s job pack', () => {
    // a row pointing at another item's asset, and a URL on no job pack at all
    expect(misfiledRawMirrors([item()], [
      row({ item_id: 'item-2' }),
      row({ id: 'row-x', source_url: u('stranger.mov') }),
    ])).toEqual([])
  })

  it('ignores a pasted link, which was never a file of ours', () => {
    const linked = item({ raw_assets: [{ url: 'https://youtu.be/abc', name: 'brief' }] })
    expect(misfiledRawMirrors([linked], [
      row({ source_url: 'https://youtu.be/abc' }),
    ])).toEqual([])
  })

  it('caps a run, and the rest are still misfiled next time', () => {
    const many = item({
      raw_assets: Array.from({ length: 12 }, (_, i) => ({ url: u(`f${i}.mov`), name: `f${i}` })),
      versions: [],
    })
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ id: `row-${i}`, source_url: u(`f${i}.mov`), drive_file_id: `gd-${i}` }))
    expect(misfiledRawMirrors([many], rows, 5)).toHaveLength(5)
    expect(misfiledRawMirrors([many], rows, 0)).toEqual([])
    expect(misfiledRawMirrors([many], rows)).toHaveLength(12)
  })

  it('shrugs at nothing at all', () => {
    expect(misfiledRawMirrors(null, null)).toEqual([])
    expect(misfiledRawMirrors([{ id: 'x' }], [row()])).toEqual([])
    expect(misfiledRawMirrors([item()], [])).toEqual([])
  })
})
