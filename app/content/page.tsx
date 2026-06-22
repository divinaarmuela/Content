import { Camera, Video, Mic, Megaphone, PenLine, Shapes } from 'lucide-react'
import ScrollObserver from '../components/ScrollObserver'
import GlowHero from '../components/GlowHero'
import ServiceList from '../components/ServiceList'
import ServiceShowcase from '../components/ServiceShowcase'
import ServiceGallery from '../components/ServiceGallery'
import ServiceAbout from '../components/ServiceAbout'
import ServiceCta from '../components/ServiceCta'
import SiteFooter from '../components/SiteFooter'

const WIX = 'https://static.wixstatic.com/media/'
const ICON = { color: '#fff', strokeWidth: 1.6 } as const

const capabilities = [
  { title: 'Photography', icon: <Camera {...ICON} />, desc: 'Editorial portraits, product, lifestyle, and behind-the-scenes, shot by a crew that gets your aesthetic from the first slate.' },
  { title: 'Short-form Video', icon: <Video {...ICON} />, desc: 'Reels, TikTok, Shorts. Hook-driven and retention-focused, cut to platform-specific rhythms, not generic 9:16 exports.' },
  { title: 'Long-form & Podcast', icon: <Mic {...ICON} />, desc: 'YouTube videos, interview series, and podcast production. End-to-end from booking to publish, including our Melbourne studio.' },
  { title: 'Ad Creative', icon: <Megaphone {...ICON} />, desc: 'Built for Meta, Google, and TikTok. Hooks engineered for thumb-stop, cuts engineered for conversion. Tested and iterated.' },
  { title: 'Copy & Scripts', icon: <PenLine {...ICON} />, desc: 'Hooks, scripts, and captions written by people who sat in the shoot and read the reporting. Words that match the strategy.' },
  { title: 'Design & Motion', icon: <Shapes {...ICON} />, desc: 'Carousels, layouts, animated explainers, and transitions, built to match your brand system, not anyone else’s template.' },
]

const process = [
  { phase: 'Day 01–03', title: 'Pre-production', desc: 'Brief confirmed, shot list built, scripts written, talent and locations locked. You approve before anyone unpacks a camera.' },
  { phase: 'Day 04–05', title: 'Shoot Day', desc: 'Full or half-day production. Camera, lighting, sound, direction. You show up, we run the rest, with a live monitor for approvals.' },
  { phase: 'Day 06–14', title: 'Post-production', desc: 'Editing, colour, audio, and motion. Copy written against the footage, not before it. First cuts delivered with revisions built in.' },
  { phase: 'Day 15–21', title: 'Delivery', desc: 'Final assets in every required format. Scheduled, published, or handed off clean. Subscription clients get rolling delivery.' },
]

const frames = [
  'c5a69a_ee1b3ff7d02f49d48e861525a53f854e~mv2.jpg',
  'c5a69a_d9b7c76f5ef24425831a0a028267fa48~mv2.jpg',
  'c5a69a_f43a41c30b844b9ea6e5b277402c0d20~mv2.jpg',
  'c5a69a_613d011236db474e8598f904efd901cf~mv2.jpg',
].map((f) => `${WIX}${f}`)

export default function ContentPage() {
  return (
    <>
      <main>
        <GlowHero
          tag="Content Production · Creative Assets"
          lead="Content"
          mid={<> that converts,<br />not content that </>}
          trail="exists."
          desc={<>Photography, video, and copy engineered to sell. Subscription or project-based. Melbourne studio, Australia-wide production.</>}
          actions={
            <>
              <a href="#contact" className="hero-glow-btn hero-glow-btn-sharp">
                Book production
              </a>
              <a
                href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone"
                target="_blank"
                rel="noreferrer noopener"
                className="hero-glow-btn hero-glow-btn-sharp hero-glow-btn-pulse"
              >
                Book a call
                <span className="btn-pulse-dot" aria-hidden="true"></span>
              </a>
            </>
          }
        />

        <div id="craft">
          <ServiceList headerTag="One studio, every asset" items={capabilities} />
        </div>

        <ServiceGallery
          eyebrow="· Selected Work / 04 Frames"
          right="MDM_STUDIO / 2024–2026"
          images={frames}
          alt="MD Media content production"
        />

        <ServiceShowcase
          eyebrow="· How It Works"
          heading={<>From brief to broadcast in 21 days.</>}
          items={process}
        />

        <ServiceAbout
          eyebrow="· Built From the Lens"
          heading={<>Run by the people behind the monitor.</>}
          image="/martindivina.avif"
          imageAlt="Divina Armuela and Martin Kormushoski, co-founders of MD Media"
          paragraphs={[
            <>Most content agencies are run by account managers. We are run by people who have been in the room, on the shoot, behind the monitor. Every decision is made by someone who has actually made content before.</>,
            <>Our team of 15 runs on a pod model. Same strategist, same producer, same editor, every shoot. No rotating freelancers, no quality drift between months, no &ldquo;who worked on this one?&rdquo;</>,
            <>Today we produce for 17 active retainers and run project shoots across finance, hospitality, real estate, health, automotive, and personal brands. The best content comes from understanding the business, not just the brief.</>,
          ]}
        />

        <ServiceCta
          ready="Ready?"
          sub="Limited monthly intake: three new subscriptions and two projects booked a month. Tell us what you need produced and we'll be in touch."
          buttonLabel="Or Just Say Hello"
        />
      </main>

      <SiteFooter
        vol="Vol. 03 // Content Production"
        tagline={<>Photo. Video. Copy.<br />Produced in-house for businesses that want content worth watching.</>}
      />

      <ScrollObserver />
    </>
  )
}
