import type { Section, TemplateDefinition } from './intake-core'

/**
 * The monthly "Content Itinerary" questionnaire, as data.
 *
 * This is the DEFAULT a new monthly form starts from. Staff can then tailor the
 * questions per form (the questions rarely change month to month, but a client
 * who customises theirs keeps those edits — the create dialog can copy last
 * month's questions forward). The shape is the intake block model, reused
 * wholesale: same Block / Section / TemplateDefinition types, same renderers,
 * same completion/merge logic.
 *
 * Block ids are STABLE. Relabel freely; never rename an id — answers key off it.
 *
 * `key` is 'one_off' only to satisfy the shared TemplateDefinition type; the
 * monthly form has no template_key column and never branches on it.
 */

const WELCOME: Section = {
  id: 'intro', title: 'Your monthly check-in',
  blocks: [{
    id: 'welcome', type: 'guidance',
    label:
      'Takes about 5 minutes. Bullet points are fine. This is exactly what we ' +
      'use to plan your month — the more real, the better. Answer what you can; ' +
      'anything you skip we pick up on the call.',
  }],
}

const LAST_MONTH: Section = {
  id: 'last_month', title: 'Last month',
  blocks: [
    { id: 'your_name', type: 'short_text', label: 'Your name' },
    {
      id: 'last_month_recap', type: 'long_text',
      label: "How did last month's content go?",
      help: 'What you made, what you enjoyed putting out, anything you noticed.',
    },
    {
      id: 'last_month_results', type: 'long_text',
      label: 'Did anything come from it?',
      help: 'Inquiries, DMs, bookings, new followers — which post, if you remember.',
    },
    {
      id: 'posts_made', type: 'select',
      label: "Honestly, how many of last month's posts did you actually make?",
      options: ['All', 'Most', 'About half', 'A few', 'Almost none'],
      help: 'No judgment — it just helps us plan around your real life.',
    },
  ],
}

const THIS_MONTH: Section = {
  id: 'this_month', title: "This month & what's ahead",
  blocks: [
    {
      id: 'upcoming', type: 'long_text',
      label: "What's coming up in your business over the next 4–6 weeks?",
      help:
        'Launches, promos, price changes, busy seasons, new offers, time off. ' +
        'If it\'s happening, we plan around it.',
    },
    { id: 'new_goals', type: 'long_text', label: 'Any new goals for this month?' },
  ],
}

const CONTENT_FUEL: Section = {
  id: 'content_fuel', title: 'Content fuel',
  blocks: [
    {
      id: 'opinions', type: 'long_text',
      label: 'What opinions have you been sitting on?',
      help:
        'Something in your industry you disagree with, a trend that gets under ' +
        'your skin, a hill you\'ll happily die on — your best content comes from here.',
    },
    {
      id: 'client_signals', type: 'long_text',
      label: 'What are you hearing from your clients lately?',
      help:
        'Questions they keep asking, things they get confused about, wins worth ' +
        'celebrating, or a story that stuck with you.',
    },
  ],
}

/** The frozen default. `key: 'one_off'` is a type placeholder only. */
export const MONTHLY_TEMPLATE: TemplateDefinition = {
  key: 'one_off',
  name: 'Monthly update — Content Itinerary',
  sections: [WELCOME, LAST_MONTH, THIS_MONTH, CONTENT_FUEL],
}

/** Never throws — the questions a brand-new monthly form starts from. */
export function monthlyTemplate(): TemplateDefinition {
  return MONTHLY_TEMPLATE
}
