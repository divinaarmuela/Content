import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ScrollObserver from '../../components/ScrollObserver'
import SiteFooter from '../../components/SiteFooter'
import { articles, getArticle } from '../journalData'

export function generateStaticParams() {
  return articles.map(a => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) return {}
  return {
    title: `${article.title} — MD Media Journal`,
    description: article.standfirst,
    robots: 'index, follow',
    alternates: { canonical: `https://www.mdmmarketing.com.au/journal/${article.slug}` },
    openGraph: {
      type: 'article',
      url: `https://www.mdmmarketing.com.au/journal/${article.slug}`,
      title: article.title,
      description: article.standfirst,
      siteName: 'MD Media Marketing',
      locale: 'en_AU',
    },
  }
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = getArticle(slug)
  if (!article) notFound()

  const index = articles.findIndex(a => a.slug === article.slug)
  const next = articles[(index + 1) % articles.length]

  return (
    <>
      <main className="ed-main">
        <article>
          <header className="art-hero">
            <div className="container">
              <a className="art-back" href="/journal">← The Journal</a>
              <h1 className="art-h1">{article.title}</h1>
              <p className="art-standfirst">{article.standfirst}</p>
              <div className="art-meta">
                <span>MD Media</span>
                <span>{article.date}</span>
                <span>{article.readMins} min read</span>
              </div>
            </div>
          </header>

          <div className="container">
            <div className="art-body">
              {article.sections.map((s, i) => (
                <section key={i}>
                  {s.heading && <h2>{s.heading}</h2>}
                  {s.paragraphs.map((p, j) => <p key={j}>{p}</p>)}
                  {s.callout && (
                    <div className="art-callout">
                      <p>{s.callout}</p>
                    </div>
                  )}
                </section>
              ))}

              <div className="art-next">
                <p className="art-next-label">Read next</p>
                <a href={`/journal/${next.slug}`}>{next.title} →</a>
              </div>
            </div>
          </div>
        </article>

        <section className="cta-section" id="contact">
          <div className="container">
            <div className="cta-split">
              <div className="cta-left">
                <p className="cta-ready">Reading is the easy part.</p>
                <h2 className="cta-heading">
                  Want this done<br />
                  <span className="blue">for you?</span>
                </h2>
                <p className="cta-sub">
                  Ten minutes on a call and we&apos;ll map what a content system looks like for your business.
                </p>
                <div className="cta-btns">
                  <a
                    href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone"
                    className="btn"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Book a call <span className="arr">→</span>
                  </a>
                  <a href="/journal" className="btn btn-outline">
                    More articles <span className="arr">→</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter vol="The Journal" />
      <ScrollObserver />
    </>
  )
}
