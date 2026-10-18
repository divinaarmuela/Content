/** Asana's date words, shared by the list, the board, the calendar and the panel (18 Oct 2026). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const dayMs = (k: string) => new Date(`${k}T00:00:00Z`).getTime()

/** Today / Tomorrow / Yesterday, else "Oct 5" (with the year when it is not this one) */
export function shortDue(due: string, today: string): string {
  const diff = Math.round((dayMs(due) - dayMs(today)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  const [y, m, d] = due.split('-')
  return `${MONTHS[Number(m) - 1]} ${Number(d)}${y !== today.slice(0, 4) ? `, ${y}` : ''}`
}

/** red when late, green for today and tomorrow, grey otherwise — Asana's colours in our tokens */
export function dueTone(due: string | null | undefined, today: string, done: boolean): string {
  if (!due || done) return 'text-muted-foreground'
  if (due < today) return 'text-accent-red-deep'
  const diff = Math.round((dayMs(due) - dayMs(today)) / 86400000)
  if (diff <= 1) return 'text-accent-green-deep'
  return 'text-muted-foreground'
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** the 6×7 grid of day keys for a month, weeks starting Monday */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month, 1 - lead))
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10))
}
