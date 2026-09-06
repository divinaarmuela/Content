import { describe, expect, it } from 'vitest'
import {
  LINK_LABELS, linkKindOf, linkLabel, nextVersionAfterLink, versionWord,
} from '../app/lib/card-link-core'

describe('linkKindOf — a pasted link is a link', () => {
  it('knows Google Drive by host', () => {
    for (const u of [
      'https://drive.google.com/file/d/1AbC/view?usp=sharing',
      'https://drive.google.com/drive/folders/1AbC',
      'https://docs.google.com/document/d/1AbC/edit',
      'https://DRIVE.GOOGLE.COM/file/d/1AbC/view',
    ]) {
      expect(linkKindOf(u)).toMatchObject({ ok: true, kind: 'drive', label: 'Google Drive' })
    }
  })

  it('knows Dropbox by host, subdomains included', () => {
    for (const u of [
      'https://www.dropbox.com/s/abc/reel.mp4?dl=0',
      'https://dropbox.com/scl/fo/abc',
      'https://www.dropbox.com/scl/fi/abc/file.mov',
      'https://team.dropbox.com/home/Clients',
    ]) {
      expect(linkKindOf(u)).toMatchObject({ ok: true, kind: 'dropbox', label: 'Dropbox' })
    }
  })

  it('keeps any other https link as a plain Link', () => {
    expect(linkKindOf('https://vimeo.com/123456')).toMatchObject({ ok: true, kind: 'other', label: 'Link' })
    expect(linkKindOf('https://app.frame.io/reviews/abc')).toMatchObject({ ok: true, kind: 'other' })
  })

  it('matches hosts, not substrings', () => {
    expect(linkKindOf('https://evil.example/drive.google.com/file')).toMatchObject({ kind: 'other' })
    expect(linkKindOf('https://drive.google.com.evil.example/file')).toMatchObject({ kind: 'other' })
    expect(linkKindOf('https://notdropbox.com/x')).toMatchObject({ kind: 'other' })
  })

  it('refuses anything that is not https', () => {
    expect(linkKindOf('http://drive.google.com/file/d/1AbC/view'))
      .toEqual({ ok: false, reason: 'Links must start with https://' })
    expect(linkKindOf('ftp://dropbox.com/x')).toMatchObject({ ok: false })
    expect(linkKindOf('javascript:alert(1)')).toMatchObject({ ok: false })
  })

  it('refuses rubbish and emptiness in plain words', () => {
    expect(linkKindOf('')).toEqual({ ok: false, reason: 'Paste a link first' })
    expect(linkKindOf(null)).toMatchObject({ ok: false })
    expect(linkKindOf('   ')).toMatchObject({ ok: false, reason: 'Paste a link first' })
    expect(linkKindOf('drive.google.com/file/d/1AbC')).toMatchObject({ ok: false })
    expect(linkKindOf('not a link')).toMatchObject({ ok: false })
  })

  it('trims and returns the cleaned URL', () => {
    const r = linkKindOf('  https://www.dropbox.com/s/abc  ')
    expect(r).toMatchObject({ ok: true, url: 'https://www.dropbox.com/s/abc' })
  })

  it('labels are the three plain words', () => {
    expect(LINK_LABELS).toEqual({ drive: 'Google Drive', dropbox: 'Dropbox', other: 'Link' })
    expect(linkLabel('drive')).toBe('Google Drive')
    expect(linkLabel('nonsense')).toBe('Link')
    expect(linkLabel(null)).toBe('Link')
  })
})

describe('versionWord — "version 3", never sub-cards', () => {
  it('says the number', () => {
    expect(versionWord(3)).toBe('version 3')
    expect(versionWord(0)).toBe('version 1')
    expect(versionWord(null)).toBe('version 1')
  })
})

describe('nextVersionAfterLink', () => {
  const U1 = 'https://drive.google.com/file/d/1/view'
  const U2 = 'https://drive.google.com/file/d/2/view'

  it('a first link on a fresh card is version 1', () => {
    expect(nextVersionAfterLink({ link_url: null, current_version_number: 0 }, U1))
      .toEqual({ version: 1, changed: true })
  })
  it('a first link on a card with uploaded versions keeps that number', () => {
    expect(nextVersionAfterLink({ link_url: null, current_version_number: 3 }, U1))
      .toEqual({ version: 3, changed: true })
  })
  it('replacing the link is a new version', () => {
    expect(nextVersionAfterLink({ link_url: U1, current_version_number: 1 }, U2))
      .toEqual({ version: 2, changed: true })
    expect(nextVersionAfterLink({ link_url: U1, current_version_number: 4 }, U2))
      .toEqual({ version: 5, changed: true })
  })
  it('the same link again changes nothing', () => {
    expect(nextVersionAfterLink({ link_url: U1, current_version_number: 2 }, U1))
      .toEqual({ version: 2, changed: false })
  })
})
