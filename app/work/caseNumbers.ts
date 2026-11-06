/**
 * The headline numbers a case study shows under "The numbers" (6 Nov 2026, owner's slide "01 / How we work").
 * Kept here, keyed by the project's slug, because the CMS `projects` row has no field for them yet; a case page
 * without an entry shows no numbers section. Every figure is the client's own and shared with their permission
 * — never put a number here that the source line does not back.
 */
export type CaseNumbers = {
  heading: string[]
  intro: string
  /** the big three, read left to right with arrows between them; the last one is the highlight */
  headline: { value: string; label: string }[]
  /** the smaller row underneath */
  detail: { value: string; label: string }[]
  source: string
}

export const CASE_NUMBERS: Record<string, CaseNumbers> = {
  'real-deal': {
    heading: ['Big decision, long runway.', 'We’ve done this before.'],
    intro: 'Real Deal Property clients make a six-figure decision after weeks of thinking it over. We’ve run their Meta ads, CRM and content since May 2026.',
    headline: [
      { value: '$97K', label: 'Ad spend' },
      { value: '$528K', label: 'Client value generated' },
      { value: '5.4x', label: 'Return on ad spend' },
    ],
    detail: [
      { value: '971', label: 'Leads, May to Aug' },
      { value: '378', label: 'Booked calls' },
      { value: '$79', label: 'Cost per lead' },
      { value: '39%', label: 'Of leads book a call' },
    ],
    source: 'Spend, client value and ROAS are rough figures for the program to date. Lead figures cover 1 May to 31 August 2026. Source: Meta Ads Manager and HubSpot. Shared with Real Deal Property’s permission.',
  },
}
