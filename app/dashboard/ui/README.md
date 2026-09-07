# `app/dashboard/ui` — the dashboard's shared look

Every component here is presentation: props in, markup out. None of them fetch,
subscribe or decide anything — the page keeps its `useTable`/`useRow`/`useLive`
hooks and hands the result down. Colours come from the `.dbx` tokens in
`app/globals.css` through the Tailwind names in `tailwind.config.js` (`ink`,
`cream`, `paper`, `surface`, `tint-*`, `accent-*`, radii `card`/`inner`/`tile`),
so a card that is amber in light mode becomes the 18% amber overlay in dark mode
without any component knowing about it.

Anything a finger can hit is at least 44px. Controls here are 44px outright;
`components/ui/button.tsx` also carries a `[@media(pointer:coarse)]` 44px floor
in its base classes, so a call site that shrinks a button for a dense desktop
row (`h-7 w-7`) still hands a phone a real target. Losing those two classes is
invisible on a laptop, which is how they once went missing — `tests/button-touch-floor.test.ts` pins them.

`Shell` and `MiniCalendar` are client components — the shell holds the mobile
sheet, the theme toggle and Clerk's user button. The rest render on the server.

`tone.ts` is not a component: it is the one map from a row's state to a card
tint and a chip colour, shared by Production, Editor and Scheduler so the same
fact cannot be two colours on two pages. `tests/tone.test.ts` pins it.

---

## Shell

The sidebar, the top bar and the page frame. Mounted once by
`app/dashboard/layout.tsx`, which keeps the hooks and the whole access decision
and passes the answer down. Also exports the nav data (`NAV_MAIN`,
`NAV_SOCIAL_CHILDREN`, `NAV_TOOLS`) that the layout reads.

```tsx
<Shell role={role} granted={granted} hidden={hidden} path={path} dark={dark} onToggleTheme={toggle}>
  {page}
</Shell>
```

## PageTitle

The heading block at the top of a page: a 40px title (30px on a phone), an
optional plain sentence saying what the page is for, and a slot for the page's
own buttons.

```tsx
<PageTitle
  title="Production"
  summary="Everything being planned, shot and edited right now."
  actions={<Button>New item</Button>}
/>
```

## TintCard

A colour-tinted panel, 22px radius, 22/24px padding, with a 17/600 title and one
optional link out. The tone is the meaning: `amber` needs you, `blue` is going
out, `green` is ready to look at, `paper` and `surface` are neutral. `surface` is
the only tone with a border — white on cream has nothing else to separate it
from the canvas.

```tsx
<TintCard tone="blue" title="Going out this week" action={{ label: 'Scheduler', href: '/dashboard/scheduler' }}>
  <div className="flex gap-7">
    <Stat value={6} label="scheduled" />
    <Stat value={2} label="ready to schedule" />
  </div>
</TintCard>
```

## Stat

One 30/700 number with a 13/500 muted label under it. Several sit in a row
inside a `TintCard`. Write the label in lower-case plain words that read
straight on from the number — "4 waiting on you", not "4 PENDING_REVIEW".

```tsx
<Stat value={4} label="waiting on you" />
```

## Chip

A 12/600 pill stating a fact — never a button, and never the only place an
action lives. Tones: `ink` (the current thing), `surface` (a white chip sitting
on a tint), `blue`, `green`, `amber`, `red` and `muted` (a plain count, the
default). If a chip needs to be clickable, wrap it in a `Link` rather than
shrinking a 24px pill into a tap target.

```tsx
<Chip tone="amber">Due today</Chip>
<Chip>6 deliverables</Chip>
```

## Lane

One column of a board: the name, how many things are in it, and the cards. Used
by Production, Editor and Scheduler.

```tsx
<Lane title="Editing" count={items.length}>
  {items.map(i => <WorkCard key={i.id} {...i} />)}
</Lane>
```

## WorkCard

One piece of work: the client small and upper case, the title, an optional still,
a row of chips and the people holding it. The whole card is the link, and `tone`
tints the whole card so the one that needs attention is obvious before anything
is read. Avatars are 26px; three are shown and the rest become "+N". Their
colour is a brand accent token picked by a stable hash of `id` (falling back to
`name`, then `initials`), so the same person keeps the same colour on every
board — pass `id` whenever you have one.

```tsx
<WorkCard
  href={`/dashboard/production/${item.id}`}
  client="Pure Allure"
  title="Spring reel v2"
  thumb={item.thumbUrl}
  tone="amber"
  chips={<Chip tone="surface">Due today</Chip>}
  people={[{ id: item.editorId, initials: 'JM', name: 'Jess M' }]}
/>
```

## MiniCalendar

A Monday-first month grid for the right-hand rail. Today is filled ink; days
with something on them are tinted — shoots amber, posts blue, client reviews
green — and a day with more than one takes the loudest. Each day is a real 44px
button with the 34px dot centred inside it, so the tap areas touch without
overlapping and the edge of a cell belongs to that cell; the card's padding is
12px because seven 44px columns need 308px and the rail is 336px. Give it at
least 332px of width. Dates are plain `YYYY-MM-DD` strings so nothing
depends on the reader's clock agreeing with Melbourne's; "today" is read after
mount, or passed in as `today` for a test. The arrows only appear when
`onMonthChange` is given, and `action` is the 44px ink button under the grid.

```tsx
<MiniCalendar
  month={month}
  markers={[{ date: '2026-09-16', kind: 'shoot' }, { date: '2026-09-18', kind: 'post' }]}
  onMonthChange={setMonth}
  onPick={date => router.push(`/dashboard/bookings?date=${date}`)}
  action={{ label: 'Book a shoot', href: '/dashboard/bookings' }}
/>
```

## Timeline

Today in order: the time down the left, what is happening beside it in a tinted
block. `time` is already formatted for a person, and an item with `href` becomes
a link. An empty day says so in plain words rather than showing nothing.

```tsx
<Timeline items={[
  { time: '09:00', title: 'Studio shoot — Pure Allure', detail: 'Room A · 2 hours', tone: 'amber' },
  { time: '12:00', title: 'Post goes live — Sui Kitchen', detail: 'Instagram reel', tone: 'blue', href: '/dashboard/scheduler' },
]} />
```
