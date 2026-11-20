/**
 * THE DISCOVERY PAGES' BACKGROUND (the owner, 20 Nov 2026: "i want the form pages to be like the landing page … but
 * not the client intake form"). The site's dotted field, and two soft blue lights drifting slowly past one another.
 * One place for it, so the discovery landing page and the discovery form behind it can never drift apart. The intake
 * forms made for clients do not draw it.
 *
 * `fixed` holds it to the screen (the form scrolls under a docked bar); without it the light sits at the top of the
 * page and scrolls away (the landing page). Still for anyone who has asked their device for less motion. Drawn
 * behind everything and never in the way of a tap.
 */
export default function BrandBackdrop({ fixed = false }: { fixed?: boolean }) {
  const at = fixed ? 'fixed' : 'absolute'
  return (
    <>
      <style>{`@keyframes brand-glow-a{0%{transform:translate(-78%,-6%) scale(1)}50%{transform:translate(-24%,10%) scale(1.18)}100%{transform:translate(-78%,-6%) scale(1)}}@keyframes brand-glow-b{0%{transform:translate(-8%,18%) scale(1.1)}50%{transform:translate(-92%,-4%) scale(.9)}100%{transform:translate(-8%,18%) scale(1.1)}}.brand-glow-a{transform:translate(-50%,0);animation:brand-glow-a 16s ease-in-out infinite}.brand-glow-b{transform:translate(-50%,0);animation:brand-glow-b 21s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.brand-glow-a,.brand-glow-b{animation:none}}`}</style>
      <div aria-hidden className={`pointer-events-none ${at} inset-0 z-0 bg-lama-dots [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]`} />
      <div aria-hidden className={`brand-glow-a pointer-events-none ${at} -top-40 left-1/2 z-0 h-[520px] w-[820px] max-w-[140vw] rounded-full bg-accent/25 blur-[120px]`} />
      <div aria-hidden className={`brand-glow-b pointer-events-none ${at} -top-10 left-1/2 z-0 h-[380px] w-[560px] max-w-[110vw] rounded-full bg-[#5b3df5]/20 blur-[110px]`} />
    </>
  )
}
