/**
 * WHO SAID IT, AT A GLANCE (the owner, 30 Oct 2026: "add colors to these comments on portal and our dashboard, its a
 * bit hard to see and differentiate"). The client's words sit on blue, MD Media's on green — the same on the portal
 * and the dashboard, on the plan's words, a board card and the general thread. The words commented ON stay amber.
 * Plain colour tokens (globals.css), each with its own dark-mode value; no opacity modifiers, which a hex token ignores.
 */
export const COMMENT_TONE = {
  client: {
    box: 'border-l-[3px] border-accent-blue bg-tint-blue',
    chip: 'bg-accent-blue text-white',
    label: 'Client',
  },
  team: {
    box: 'border-l-[3px] border-accent-green bg-tint-green',
    chip: 'bg-foreground text-background',
    label: 'MD Media',
  },
} as const

export const toneOf = (fromTeam: boolean | null | undefined) => (fromTeam ? COMMENT_TONE.team : COMMENT_TONE.client)
