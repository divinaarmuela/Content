import { Scramble } from './lama/Scramble'

/** Eyebrow label for editorial pages that decodes with the homepage's
 *  scramble effect when scrolled into view. Ungated — these pages have no
 *  preloader to wait for. */
export default function ScrambleEyebrow({ text }: { text: string }) {
  return (
    <p className="ed-eyebrow">
      <Scramble text={text} gate={false} />
    </p>
  )
}
