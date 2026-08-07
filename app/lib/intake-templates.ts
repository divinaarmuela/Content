import type { Section, TemplateDefinition, TemplateKey } from './intake-core'

/**
 * The three intake questionnaires, as data.
 *
 * Authored in code deliberately: there is one proven template (the Emerald
 * rebrand form) and building a dashboard form builder before the other two
 * exist would build the wrong abstraction. The shape is JSONB from the first
 * commit, so a builder is a later addition rather than a rewrite.
 *
 * Block ids are STABLE. Relabel freely; never rename an id — answers key off it,
 * and a rename silently orphans everything a client has already written.
 */

const WELCOME: Section = {
  id: 'intro', title: 'Welcome',
  blocks: [{
    id: 'welcome', type: 'guidance',
    label:
      'This form is the foundation we build everything on — the brand, the shoot, ' +
      'the content, the ongoing strategy. The more you give us here, the sharper ' +
      'the work we hand back. Take your time. There are no wrong answers, only ' +
      'honest ones. Incomplete is fine — send us what you have.',
  }],
}

const BRAND: Section = {
  id: 'brand', title: 'Brand snapshot',
  blocks: [
    { id: 'public_name', type: 'short_text', label: 'Business name, as it appears publicly' },
    { id: 'website', type: 'link', label: 'Website URL', placeholder: 'yourbusiness.com.au' },
    { id: 'socials', type: 'short_text', label: 'Instagram and other social handles' },
    { id: 'established', type: 'short_text', label: 'Year originally established' },
    { id: 'locations', type: 'short_text', label: 'Location(s)' },
    { id: 'key_date', type: 'short_text', label: 'Target opening, reopening or launch date' },
    {
      id: 'booking_channels', type: 'multi_select', label: 'Primary booking or enquiry channels',
      options: ['Enquiry form', 'Walk-in', 'Referral', 'Ads', 'Previous customers', 'Social media', 'Phone'],
    },
  ],
}

const PEOPLE: Section = {
  id: 'people', title: 'The people',
  intro: 'Who we are working with, and who appears in the story.',
  blocks: [
    { id: 'primary_contact', type: 'long_text', label: 'Primary contact — full name and title as it should appear publicly' },
    { id: 'contact_mobile', type: 'short_text', label: 'Mobile (best number for shoot day)' },
    { id: 'contact_email', type: 'short_text', label: 'Email' },
    { id: 'best_call_window', type: 'short_text', label: 'Best window for calls' },
    { id: 'on_camera_owners', type: 'long_text', label: 'Owners or family who can appear on camera', help: 'Names, relationship to the business, and how comfortable each is on camera.' },
    { id: 'on_camera_team', type: 'long_text', label: 'Team members who can appear', help: 'Anyone customer-facing. If nobody is available yet, say so.' },
    { id: 'signs_creative', type: 'short_text', label: 'Who signs off on creative' },
    { id: 'signs_spend', type: 'short_text', label: 'Who signs off on spend' },
  ],
}

const VOICE: Section = {
  id: 'voice', title: 'Brand and voice',
  blocks: [
    { id: 'three_words', type: 'short_text', label: 'Three words you should feel to a customer' },
    { id: 'never_words', type: 'short_text', label: 'Three words it should never feel' },
    { id: 'admired', type: 'long_text', label: 'Brands you admire, in any industry, and why' },
    { id: 'perception', type: 'long_text', label: 'How you want to be perceived against your competitors' },
    {
      id: 'tone', type: 'select', label: 'Tone of voice',
      options: ['Warm and family', 'Aspirational and premium', 'Both, balanced'],
    },
    { id: 'tagline', type: 'short_text', label: 'Tagline or signature phrase, if you have one' },
    { id: 'brand_files', type: 'file', label: 'Logo files, brand colours and fonts', help: 'Upload what you have — we can work from a PDF brand guide or loose files.' },
  ],
}

const PILLARS: Section = {
  id: 'pillars', title: 'Content pillars and strategy',
  intro: 'Strategy and direction come from you; we execute to the brief. Without this section we cannot build a shot list.',
  blocks: [
    { id: 'content_pillars', type: 'long_text', label: 'Your content pillars', help: 'Three to five themes you want to be known for.' },
    { id: 'pillar_meaning', type: 'long_text', label: 'What you want each pillar to communicate', help: 'Trust, detail, care, craft, legacy.' },
    { id: 'value_topics', type: 'long_text', label: 'Topics or value-led tips for your customers', help: 'The informational content that builds reach without selling.' },
  ],
}

const CUSTOMER: Section = {
  id: 'customer', title: 'The ideal customer',
  blocks: [
    { id: 'ideal_customer', type: 'long_text', label: 'Describe the customer you want to clone', help: 'Age, location, lifestyle, values, and how they choose.' },
    { id: 'they_value', type: 'long_text', label: 'What do they value most when choosing?' },
    { id: 'they_fear', type: 'long_text', label: 'What do they worry about — what would make them walk away?' },
    { id: 'booking_moment', type: 'long_text', label: 'The moment they decide to book' },
    { id: 'not_ideal', type: 'long_text', label: 'The customer you do NOT want more of' },
  ],
}

const COMPETITORS: Section = {
  id: 'competitors', title: 'Competitors and positioning',
  blocks: [
    { id: 'compared_to', type: 'short_text', label: 'Three businesses customers compare you to' },
    { id: 'their_edge', type: 'long_text', label: 'Where those competitors have an edge on you', help: 'Be honest — this is what lets us position you properly.' },
    { id: 'your_edge', type: 'long_text', label: 'Where you clearly beat them' },
    { id: 'surprising_feedback', type: 'long_text', label: 'The thing customers say afterwards that still surprises you' },
  ],
}

const VISUAL: Section = {
  id: 'visual', title: 'Visual direction',
  blocks: [
    { id: 'refs_right', type: 'long_text', label: 'Three accounts whose content feels right', help: 'Paste links — it is faster than describing them.' },
    { id: 'refs_wrong', type: 'long_text', label: 'Three that feel wrong, and why' },
    { id: 'existing_assets', type: 'long_text', label: 'Existing photography, renders or video we can use', help: 'A Drive or Dropbox link is fine.' },
    {
      id: 'mood', type: 'select', label: 'Colour palette and mood for the shoot',
      options: ['Warm and intimate', 'Bright and airy', 'Cinematic', 'Follows our brand palette'],
    },
    { id: 'visual_limits', type: 'long_text', label: 'Anything off limits visually' },
  ],
}

const LOGISTICS: Section = {
  id: 'logistics', title: 'Logistics and shoot day',
  blocks: [
    { id: 'best_days', type: 'short_text', label: 'Best days of the week to shoot', help: 'Whatever causes least disruption to your operation.' },
    { id: 'blackout_dates', type: 'long_text', label: 'Dates absolutely off limits in the next 90 days' },
    { id: 'shoot_locations', type: 'long_text', label: 'Confirmed filming locations' },
    { id: 'site_access', type: 'long_text', label: 'Site access', help: 'Safety requirements, induction, PPE, and who escorts us.' },
    { id: 'parking', type: 'short_text', label: 'Parking for crew and gear' },
    { id: 'wardrobe', type: 'long_text', label: 'Wardrobe direction for anyone on camera', help: 'Happy to guide you on this if you would rather we did.' },
    { id: 'quirks', type: 'long_text', label: 'Acoustic, lighting or layout quirks we should plan for' },
    { id: 'catering', type: 'short_text', label: 'Catering and dietary notes for shoot day' },
  ],
}

const APPROVALS: Section = {
  id: 'approvals', title: 'Approvals and sign-off',
  intro: 'One approver keeps feedback consistent. Mixed feedback is what turns two revision rounds into five.',
  blocks: [
    { id: 'approval_contact', type: 'short_text', label: 'Single approval contact', help: 'One person, to keep feedback consistent.' },
    {
      id: 'approval_turnaround', type: 'select', label: 'Agreed feedback turnaround',
      options: ['24 hours', '48 hours', '3–5 business days'],
    },
    { id: 'approval_cc', type: 'short_text', label: 'Anyone else who must see content before it goes out' },
    { id: 'claims_to_avoid', type: 'long_text', label: 'Any claims or language to avoid', help: 'Capacity, pricing, or completion dates that are not yet locked in.' },
  ],
}

const GOALS: Section = {
  id: 'goals', title: 'Goals and what success looks like',
  blocks: [
    { id: 'success_90', type: 'long_text', label: 'At our 90-day review, what would make you say this was the best decision you made this year?' },
    { id: 'healthy_presence', type: 'long_text', label: 'What does a healthy social presence look like to you?' },
    { id: 'signals', type: 'long_text', label: 'Enquiry or booking signals worth tracking', help: 'Saves, shares, DMs, enquiry quality.' },
    { id: 'off_limits', type: 'long_text', label: 'Anything you do NOT want covered or shown' },
  ],
}

const ANYTHING_ELSE: Section = {
  id: 'anything_else', title: 'Anything else',
  blocks: [
    { id: 'not_asked', type: 'long_text', label: 'What have we not asked that we should have?' },
    { id: 'nervous_about', type: 'long_text', label: 'What are you nervous about with this kind of marketing?' },
    { id: 'never_cross', type: 'long_text', label: 'The boundary we should never cross' },
  ],
}

const STORY: Section = {
  id: 'story', title: 'The story',
  intro: 'Specific and named beats generic every time. The more honest you are here, the more powerful the footage.',
  blocks: [
    { id: 'history', type: 'long_text', label: 'Your history, in your own words', help: 'How it started, and what it has meant to people over the years.' },
    { id: 'turning_point', type: 'long_text', label: 'The turning point that led to this rebuild', help: 'Only what you are comfortable sharing — and tell us if you would rather it stayed out of the content entirely.' },
    { id: 'why_rebuild', type: 'long_text', label: 'Why you chose to rebuild rather than walk away', help: 'This is usually the emotional core of the whole story.' },
    { id: 'whats_better', type: 'long_text', label: 'What is different or better about the new space' },
    { id: 'design_decisions', type: 'long_text', label: 'Key design and material decisions worth explaining on camera', help: 'And the reasoning behind them.' },
    { id: 'kept_features', type: 'long_text', label: 'Anything from before you deliberately kept', help: 'The details long-standing customers would notice and miss.' },
    { id: 'archival', type: 'long_text', label: 'Archival material available, and where it lives' },
    { id: 'milestones', type: 'long_text', label: 'Build milestones still ahead', help: 'So we can align filming with key moments before the reveal.' },
  ],
}

const LAUNCH_PLAN: Section = {
  id: 'launch_plan', title: 'The launch',
  intro: 'What you are launching, and what has to be true on day one.',
  blocks: [
    { id: 'what_launching', type: 'long_text', label: 'What exactly are you launching?' },
    { id: 'launch_date', type: 'short_text', label: 'Target launch date' },
    { id: 'why_now', type: 'long_text', label: 'Why now — what changed?' },
    { id: 'day_one_success', type: 'long_text', label: 'What does a successful launch day look like?' },
    { id: 'pre_launch_assets', type: 'long_text', label: 'What exists already', help: 'Renders, samples, prototypes, or a space we can film in.' },
  ],
}

const BRIEF: Section = {
  id: 'brief', title: 'The brief',
  blocks: [
    { id: 'deliverable', type: 'long_text', label: 'What are we making?' },
    { id: 'where_used', type: 'long_text', label: 'Where will it be used?', help: 'Socials, ads, website, in-venue screens.' },
    { id: 'deadline', type: 'short_text', label: 'Hard deadline, if there is one' },
    { id: 'brief_success', type: 'long_text', label: 'What does a good result look like?' },
  ],
}

const REBRAND: TemplateDefinition = {
  key: 'rebrand',
  name: 'Rebrand and rebuild intake',
  sections: [
    WELCOME, BRAND, PEOPLE, STORY, VOICE, PILLARS, CUSTOMER,
    COMPETITORS, VISUAL, LOGISTICS, APPROVALS, GOALS, ANYTHING_ELSE,
  ],
}

const LAUNCH: TemplateDefinition = {
  key: 'launch',
  name: 'Launch intake',
  sections: [
    WELCOME, BRAND, PEOPLE, LAUNCH_PLAN, VOICE, PILLARS, CUSTOMER,
    COMPETITORS, VISUAL, LOGISTICS, APPROVALS, GOALS, ANYTHING_ELSE,
  ],
}

const ONE_OFF: TemplateDefinition = {
  key: 'one_off',
  name: 'One-off project intake',
  sections: [
    WELCOME, BRAND, BRIEF, VOICE, VISUAL, LOGISTICS, APPROVALS, GOALS,
  ],
}

export const TEMPLATES: Record<TemplateKey, TemplateDefinition> = {
  rebrand: REBRAND,
  launch: LAUNCH,
  one_off: ONE_OFF,
}

/** Never throws — an unrecognised key from a database row must not break the
 *  page, and the one-off form asks nothing that could embarrass us. */
export function templateFor(key: TemplateKey): TemplateDefinition {
  return TEMPLATES[key] ?? TEMPLATES.one_off
}
