const logos = [
  'c5a69a_a57a94655c1d465581b0d60a633269da~mv2.png',
  'c5a69a_c1d2c702bc7a47c0a3670eaf449e48f8~mv2.png',
  'c5a69a_1ff2bb6a1aaa41ff85948094bae68cb6~mv2.png',
  'c5a69a_9f973b4c457441ea827b9c101d3b74e8~mv2.png',
  'c5a69a_9c826734acc646eb846219ac76393853~mv2.png',
  'c5a69a_9b50e5225f7243b5ad1c7826ac414bcc~mv2.png',
  'c5a69a_7785ca4f44ec4f09bcdb8ca0b0861852~mv2.png',
  'c5a69a_29646c60053a4060993c481b10aed67e~mv2.png',
  'c5a69a_ea64382bc50b443f86001d4febdb8746~mv2.png',
  'c5a69a_f2608dab4cc646c2864fa1f501217e59~mv2.png',
  'c5a69a_67b4f93fb988428b93425a6de9e7b2c4~mv2.png',
  'c5a69a_1664d27fee9744c48a2863b6b9e20ed7~mv2.png',
  'c5a69a_76c36272f9ef485d99928b7faed5cc1a~mv2.png',
]

export default function LamaLogos() {
  const doubled = [...logos, ...logos]
  return (
    // transparent over the shared canvas, like the reference's logos section
    <div aria-label="Clients and partners" className="py-10 overflow-hidden">
      <p className="mb-8 text-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim">
        Trusted by founders &amp; local businesses
      </p>
      <div className="flex w-max animate-lama-marquee motion-reduce:animate-none gap-16 px-8">
        {doubled.map((logo, i) => (
          <img
            key={i}
            src={`https://static.wixstatic.com/media/${logo}/v1/fit/w_213,h_90,q_90,enc_avif,quality_auto/${logo}`}
            alt=""
            loading="lazy"
            className="h-10 w-auto opacity-70 [filter:brightness(0)_invert(1)]"
          />
        ))}
      </div>
    </div>
  )
}
