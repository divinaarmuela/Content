/**
 * Hero headline, Sui-style: the text rests blurred with a blue glow, then
 * animates into sharp focus on hover. Pure CSS — see `.hero-glow-h1` /
 * `.hl-fx` in globals.css.
 */
export default function HeroHeadline() {
  return (
    <h1 className="hero-glow-h1">
      <span className="hl-fx">Impossible to ignore.</span>
    </h1>
  )
}
