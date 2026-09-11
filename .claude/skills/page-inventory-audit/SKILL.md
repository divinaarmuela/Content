---
name: page-inventory-audit
description: Use before claiming any dashboard page "works" or "matches the SOP", after any page rebuild, and whenever the owner says a page is confusing, cluttered or buggy. Reads every visible thing on a page against the Team's Playbook and removes what does not belong. Never claim a page is checked without running this AND rendering the page.
---

# Page inventory against the SOP

Code-level tests and pure-function walks do NOT see what a page draws. On
11 Sep 2026 the owner found, in minutes, a deliverables section hidden behind
`planned.length > 0`, a leftover "Open Drive folder" link, and a "Kind of
work" picker on the editor's New card — after a day of "audits" that never
opened a page. This skill is the read those audits skipped.

## The rule

A page is checked only when BOTH have happened:
1. **Inventory** (below) — every visible string judged against the SOP.
2. **Render** — the page opened in a real browser (Chrome MCP as the owner's
   account, or Playwright via the webapp-testing skill) in the NEW/EMPTY state
   and in a filled state, for each role that sees it.

Until both are done, say "not yet looked at", never "checked".

## Inventory, step by step

1. Open the page's tsx and every component it draws. List EVERY visible
   string: titles, labels, hints, placeholders, button labels, chip words,
   empty states, tour steps, help text. One row each in a table:
   `string · file:line · role(s) that see it · state it shows in`.
2. For each row, find the SOP line it serves (scratchpad/playbook.txt or
   docs/…Playbook). Verdict, one of: **keep**, **reword** (say the new
   words), **remove** (it serves nothing in the SOP or belongs to another
   role), **move** (right thing, wrong page/section).
3. Leftovers are the usual finds: links to old pages ("Full card", "Open
   Drive folder"), pickers the SOP never asks for ("Kind of work", "Which
   shoot?" on a new shoot), hints pointing at sections that are not drawn,
   manager buttons on a maker's page, six columns where the SOP has four.
4. Check every conditional render (`x && <…>`, ternaries, early returns,
   `isManager &&`, `length > 0 &&`): in the EMPTY/NEW state, is everything
   the words tell the person to use actually drawn? Draw the section with
   an empty-state line rather than hiding it.
5. Apply the verdicts. Prefer removing over rewording; prefer showing over
   hinting.
6. Pin each removal/showing in `tests/render-gates.test.ts` (source-pinning)
   and keep `tests/ui-a11y-source.test.ts` and `tests/vocabulary-sweep.test.ts`
   green.
7. Render (rule 2). Screenshot the empty state and one filled state per
   role. Only then report, listing what was removed and what was kept.

## Words

Plain words, one action per button, 44px targets, 12px body floor, no
em-dashes in client-facing text. A hint must name a thing that exists on the
same screen for the same role.

## Roles to walk

editor/designer, scheduler, general, account manager, super admin, quality
reviewer (a flag), client on the portal — each with a card that has a file,
one with none, and a link-only version.
