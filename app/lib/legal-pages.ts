/**
 * THE LEGAL PAGES' SWITCHES (Meta App Review groundwork, 30 Sep 2026).
 *
 * /privacy, /terms, /data-deletion, /app-info and /support were written from the code, and the
 * owner reviews the wording before any of them is relied on. While a page's
 * switch is `true` it shows a "Draft — pending owner review" banner at the
 * top and tells search engines not to index it.
 *
 * TO PUBLISH A PAGE: fill its [PLACEHOLDERS], flip its switch to `false`,
 * and change LEGAL_UPDATED to the day it goes live. Nothing else changes.
 */
export const PRIVACY_DRAFT = false
export const TERMS_DRAFT = false
export const DATA_DELETION_DRAFT = false
export const APP_INFO_DRAFT = false
export const SUPPORT_DRAFT = false

/** "Last updated" on all three pages */
export const LEGAL_UPDATED = '1 October 2026'

export const LEGAL_EMAIL = 'hello@mdmmarketing.com.au'

/** robots for a page: never indexed while it is a draft */
export function legalRobots(draft: boolean): string {
  return draft ? 'noindex, nofollow' : 'index, follow'
}
