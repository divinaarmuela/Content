import { Video, Mic, Lightbulb, Armchair, Users, Scissors } from 'lucide-react'
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

const kit = [
  { title: 'Multi-camera', icon: <Video {...ICON} />, desc: 'Up to four cinema cameras covering wides, singles, and detail, framed for long-form and pre-set for vertical pulls, so one record gives you every angle.' },
  { title: 'Broadcast Audio', icon: <Mic {...ICON} />, desc: 'Individual broadcast mics per seat, monitored and level-matched. An acoustically treated room means clean, warm sound with no rescue job in the edit.' },
  { title: 'Cinematic Lighting', icon: <Lightbulb {...ICON} />, desc: 'Recallable looks from clean-and-bright to moody-and-editorial. Set in seconds, consistent every time, so episode twelve matches episode one.' },
  { title: 'Styled Set', icon: <Armchair {...ICON} />, desc: 'A finished backdrop that reads premium on camera. Building an ongoing show? We dress and brand the set to your identity.' },
  { title: 'Crew On Call', icon: <Users {...ICON} />, desc: 'Book the crew and someone runs the cameras, watches the audio, and directs the room. You stay in the conversation, not behind the gear.' },
  { title: 'Edit & Clips', icon: <Scissors {...ICON} />, desc: 'Full episode edit plus short-form cutdowns, audiograms, and quote cards from the same team that shot it. One session, a month of content.' },
]

const flow = [
  { phase: 'Step 01', title: 'Lock the Slot', desc: 'Pick a date, tell us headcount and format, and whether you want crew. We confirm the room, brief the guests, and set the studio for your show.' },
  { phase: 'Step 02', title: 'Walk In & Record', desc: 'The room is already live. Quick brief, mic up, and roll. Ten minutes from door to recording. Crew runs cameras and audio while you talk.' },
  { phase: 'Step 03', title: 'Same-day Files', desc: 'Raw footage and audio handed over the same day, organised and labelled. Self-record clients are done here; produced clients move into the edit.' },
  { phase: 'Step 04', title: 'Edit & Publish', desc: 'Episode cut, colour and sound finished, clips and audiograms produced, delivered ready to publish, or scheduled for you on a monthly show.' },
]

const frames = [
  'c5a69a_92e33aa145994dbf85c3be0a2bf40744~mv2.jpg',
  'c5a69a_ee1b3ff7d02f49d48e861525a53f854e~mv2.jpg',
  'c5a69a_cb2b1317681a4591ab979c4db9750afb~mv2.jpg',
  'c5a69a_d9b7c76f5ef24425831a0a028267fa48~mv2.jpg',
].map((f) => `${WIX}${f}`)

export default function PodcastStudioPage() {
  return (
    <>
      <main>
        <GlowHero
          tag="Podcast & Content Studio · Melbourne"
          lead="Press"
          mid={<> record.<br />We&apos;ve handled the </>}
          trail="rest."
          desc={<>A plug-and-play podcast and content studio. Multi-cam, broadcast audio, full lighting. Book the room, or book the room and the crew.</>}
          actions={
            <>
              <a href="#contact" className="hero-glow-btn hero-glow-btn-sharp">
                Book the studio
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

        <div id="room">
          <ServiceList headerTag="Everything's already in the room" items={kit} />
        </div>

        <ServiceGallery
          eyebrow="· Inside The Studio / 04 Frames"
          right="MDM_STUDIO / ALTONA NORTH"
          images={frames}
          alt="Inside the MD Media podcast and content studio"
        />

        <ServiceShowcase
          eyebrow="· How It Works"
          heading={<>From booking to published in a week.</>}
          items={flow}
        />

        <ServiceAbout
          eyebrow="· Behind The Studio"
          heading={<>Run by the people behind the lens.</>}
          image="/martindivina.avif"
          imageAlt="Divina Armuela and Martin Kormushoski, co-founders of MD Media"
          paragraphs={[
            <>The studio isn&apos;t a side hustle in a spare room. It is the home base for a 15-person production team that shoots, edits, and distributes content every week. When you book it, you book the same setup we run our own work on.</>,
            <>Between shoots for 17 active retainers, the room stays dialled, maintained, and recallable, so your booking starts from a known-good state, not a cold rig.</>,
            <>Most studios stop at the recording. We start there. A great conversation is just raw material, and we are the team that turns raw material into a show people follow.</>,
          ]}
        />

        <ServiceCta
          ready="Ready?"
          sub="Tell us the date, the format, and whether you want the crew. We'll confirm the slot and set the studio for your show."
          buttonLabel="Or Just Say Hello"
        />
      </main>

      <SiteFooter
        vol="Vol. 04 // Podcast Studio"
        tagline={<>Multi-cam. Broadcast audio. In-house crew.<br />A plug-and-play studio for businesses that want to be watched.</>}
      />

      <ScrollObserver />
    </>
  )
}
