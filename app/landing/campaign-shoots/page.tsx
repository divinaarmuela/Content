import LandingPage from '../LandingPage'
import { ALL_LOGOS, landingMeta } from '../meta'

export const metadata = landingMeta('Campaign Shoots', 'One shoot, the whole drop covered. Campaign shoots for ecommerce brands.')

const V = '/videos/campaign-shoots'
export default function Page() {
  return <LandingPage d={{
    slug: 'campaign-shoots',
    headline: <>One shoot. The whole drop <em>covered</em>.</>,
    lead: 'Campaign shoots for ecommerce brands. We cast the models, run the full production and deliver evergreen content that lasts until your next drop. You don’t need to be there.',
    hero: { video: `${V}/hero-portrait`, label: 'Releeph Slow Mornings campaign, shot by MD Media' },
    ctas: ['Explore your options', 'Plan your next drop', 'See what we’d shoot for you', 'Start the conversation'],
    note: 'Free · no obligation',
    logos: ALL_LOGOS,
    problems: {
      heading: 'Your drop lasts 3 months. Your content lasts 3 weeks.',
      pairs: [
        ['Your launch content runs out halfway through the drop.', 'You shoot for launch and post the lot in the first fortnight, then spend the rest of the season recycling the same six photos.'],
        ['Your ads go stale and your feed goes quiet.', 'Sales slow down before the next drop has even landed, because there’s nothing new to show.'],
        ['You’re shooting on your phone between orders.', 'You’d rather run the business than run a shoot, so content keeps getting pushed back.'],
        ['You release drops or collections on a schedule.', 'That’s exactly who this is for: one shoot per drop, planned so the content lasts the whole season.'],
      ],
    },
    workHeading: 'What you get from one shoot.',
    work: [
      { name: 'Campaign images', kind: 'Hero, lookbook and lifestyle', media: { video: `${V}/get-images`, label: 'Campaign images from an MD Media shoot' } },
      { name: 'Videos for ads and Reels', kind: '9:16, 4:5 and 1:1', media: { video: `${V}/get-02`, label: 'Ad and Reel video from an MD Media shoot' } },
      { name: 'Detail and texture shots', kind: 'Fabric, finish, close-ups', media: { video: `${V}/get-03`, label: 'Detail shots from an MD Media shoot' } },
      { name: 'A content plan', kind: 'What goes out when, so it lasts the whole drop', media: { video: `${V}/get-04`, label: 'Content plan from an MD Media shoot' } },
    ],
    included: {
      heading: 'You send the box. We do the rest.',
      items: [
        { title: 'Creative direction', desc: 'We agree the vision for the drop with you, then plan the shoot backwards from it.' },
        { title: 'Casting & models', desc: 'Models cast to your brand, with releases that cover your ads.' },
        { title: 'Styling & location', desc: 'Stylist, hair and makeup, set and location, sorted.' },
        { title: 'Full crew', desc: 'Producer, photographer, cinematographer, lighting and grip, run by our creative director.' },
        { title: 'Editing & retouching', desc: 'Retouched images and edited video, graded to your brand.' },
        { title: 'Every format', desc: 'Cut-downs for ads, Reels, feed and your site, ready to post.' },
      ],
    },
    strip: [
      { src: `${V}/still-01`, alt: 'Campaign still' },
      { src: `${V}/hero-portrait`, alt: 'Releeph Slow Mornings' },
      { src: `${V}/still-02`, alt: 'Campaign still' },
      { src: `${V}/get-images`, alt: 'Campaign images' },
      { src: `${V}/still-03`, alt: 'Campaign still' },
      { src: `${V}/how`, alt: 'On set' },
      { src: `${V}/still-04`, alt: 'Campaign still' },
      { src: `${V}/bts`, alt: 'Behind the scenes' },
    ],
    steps: [
      ['Brief', 'Your vision for the drop and the creative direction, agreed together.'],
      ['Send the product', 'Courier it to us. That’s your part done.'],
      ['We run the production', 'Casting and models, styling, location, crew and the shoot day.'],
      ['You get the library', 'Campaign images, video for ads and Reels, cut-downs in every format, and detail shots.'],
      ['Next drop, repeat', 'Same team, same standard, every season.'],
    ],
    faqs: [
      ['Do I need to be at the shoot?', 'No. You send the product. We handle everything from casting to final edits.'],
      ['Can you match our brand’s look?', 'Yes. We work from your brand guidelines and past campaigns, and lock the creative direction with you before shoot day.'],
      ['What happens to my products?', 'Returned after the shoot, or kept for samples.'],
      ['How much does it cost?', 'It’s priced by project: the number of products, models and deliverables. We’ll give you a straight number on the call.'],
    ],
  }} />
}
