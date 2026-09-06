import type { LucideIcon } from 'lucide-react'
import {
  Calendar, Camera, Film, Folder, Image as ImageIcon, Lightbulb, MapPin, Shirt, Sparkles, Star, Tag, Users,
} from 'lucide-react'
import type { BoardIcon, CanvasColour } from '@/app/lib/board-canvas-core'

/**
 * The canvas's swatches and icons as CLASSES — the one place a stored token
 * name becomes a look. The tokens are the restyle's tints, so a note that is
 * amber in light mode is the 18% amber overlay in dark mode, and the swatch
 * row can never make something unreadable.
 *
 * Presentation only. The names themselves live in board-canvas-core.
 */

export const COLOUR_CLASS: Record<CanvasColour, string> = {
  surface: 'bg-surface text-foreground border border-border',
  paper: 'bg-paper text-foreground',
  blue: 'bg-tint-blue text-foreground',
  green: 'bg-tint-green text-foreground',
  amber: 'bg-tint-amber text-foreground',
  red: 'bg-tint-red text-foreground',
  ink: 'bg-foreground text-background',
}

/** The dot on a swatch button. */
export const SWATCH_CLASS: Record<CanvasColour, string> = {
  surface: 'bg-surface border border-border',
  paper: 'bg-paper border border-border',
  blue: 'bg-tint-blue border border-accent-blue/40',
  green: 'bg-tint-green border border-accent-green/40',
  amber: 'bg-tint-amber border border-accent-amber/50',
  red: 'bg-tint-red border border-accent-red/40',
  ink: 'bg-foreground',
}

export const ICON: Record<BoardIcon, LucideIcon> = {
  folder: Folder, camera: Camera, film: Film, image: ImageIcon, lightbulb: Lightbulb,
  'map-pin': MapPin, users: Users, star: Star, calendar: Calendar, tag: Tag, shirt: Shirt, sparkles: Sparkles,
}
