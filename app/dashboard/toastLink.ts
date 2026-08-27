import { toast } from 'sonner'

/**
 * "It happened, and it went THERE" — with a way to go there.
 *
 * A toast that says "Sent for review" answers half the question; the other
 * half is "so where is it now?". This one names the place and carries an
 * Open button, so the confirmation is also the shortcut.
 */
export function toastOpen(
  message: string,
  href: string,
  go: (href: string) => void,
  label = 'Open',
): void {
  toast.success(message, { action: { label, onClick: () => go(href) } })
}
