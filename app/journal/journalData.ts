export type ArticleSection = {
  heading?: string
  paragraphs: string[]
  callout?: string
}

export type Article = {
  slug: string
  title: string
  standfirst: string
  // provisional publish dates — Divina to confirm real dates before launch
  date: string
  readMins: number
  featured?: boolean
  sections: ArticleSection[]
}

export const articles: Article[] = [
  {
    slug: 'mental-availability',
    title: 'Mental availability: why the best business still loses to the known one',
    standfirst:
      'Buyers don’t choose the best option. They choose the one they can remember at the moment the need shows up.',
    date: 'July 2026',
    readMins: 5,
    featured: true,
    sections: [
      {
        paragraphs: [
          'There is a business in your suburb right now that does what you do, worse than you do it, and gets more of the work. That isn’t an injustice. It’s a mechanism — and once you see it, you can use it.',
          'Marketing scientists call it mental availability: the probability that a buyer thinks of you in a buying situation. Not whether they like you. Not whether they’d recommend you if asked. Whether you show up, uninvited, in their head at the exact moment the need appears.',
        ],
      },
      {
        heading: 'Nobody shortlists from scratch',
        paragraphs: [
          'When someone needs an accountant, a venue, a builder, they don’t run a fair tender across the whole market. They pull from a shortlist their memory already made — usually two or three names — and pick from that. If you’re not on the list before the need arrives, the quality of your work never gets a vote.',
          'This is why "our work speaks for itself" is the most expensive sentence in small business. Work can’t speak to people who never see it. The known-but-average business beats the excellent-but-invisible one almost every time.',
        ],
      },
      {
        heading: 'How memory gets built',
        paragraphs: [
          'Mental availability is built through consistent, repeated, distinctive exposure — showing up in the feeds, inboxes, and rooms where your buyers already are, looking recognisably like yourself every time.',
          'Frequency beats intensity. One brilliant campaign that runs for a month does less than a decent presence sustained for a year, because memory decays and needs topping up. This is the actual argument for consistent content: not engagement, not virality — memory.',
        ],
        callout:
          'The goal of your marketing is not to convince. It’s to be remembered. Persuasion happens later, in the sales conversation you only get if they thought of you first.',
      },
      {
        heading: 'What to do with this',
        paragraphs: [
          'Pick the two or three buying situations that matter most for your business. Then audit yourself honestly: when that moment happens to a stranger in your market, is there any mechanism — content, ads, email, community — that would have put your name in their head beforehand?',
          'If the answer is no, that’s the gap. Everything else in this journal is about closing it.',
        ],
      },
    ],
  },
  {
    slug: 'content-cadence',
    title: 'Content cadence: staying top of mind without burning out',
    standfirst:
      'The businesses that stay visible aren’t the ones working hardest. They’re the ones with a cadence they can actually sustain.',
    date: 'June 2026',
    readMins: 4,
    sections: [
      {
        paragraphs: [
          'Every business owner has run the sprint: two weeks of posting daily, fuelled by a burst of motivation, followed by three months of silence. The feed dies, the audience forgets, and the next sprint starts from zero.',
          'The problem isn’t discipline. It’s that the cadence was never designed — it was borrowed from whatever a louder account seemed to be doing.',
        ],
      },
      {
        heading: 'Sustainable beats impressive',
        paragraphs: [
          'Memory needs repetition over time, not volume in bursts. Three posts a week for a year builds more mental availability than daily posting that collapses after six weeks. When choosing a cadence, the question is not "what’s optimal?" It’s "what can we still be doing in month nine?"',
        ],
      },
      {
        heading: 'Batch, then drip',
        paragraphs: [
          'The trick that makes cadence sustainable is separating production from publishing. One well-planned shoot day produces weeks of material; the calendar then drips it out on schedule whether you’re busy, sick, or on holiday.',
          'Producing on the day you post is how burnout happens — every piece of content becomes an emergency. Batching turns content into inventory.',
        ],
        callout:
          'Consistency is a systems problem, not a willpower problem. Fix the system and the willpower stops being required.',
      },
      {
        heading: 'A cadence worth copying',
        paragraphs: [
          'Start with one shoot a month, three posts a week, and one email a fortnight. Modest, almost boring — and sustained for a year it will outperform nearly every sprint-and-silence competitor in your market.',
        ],
      },
    ],
  },
  {
    slug: 'what-a-brand-is',
    title: 'What a brand actually is (and why a logo isn’t it)',
    standfirst:
      'A logo is a signature. A brand is the reputation the signature points to.',
    date: 'June 2026',
    readMins: 4,
    sections: [
      {
        paragraphs: [
          'When most businesses say "we need branding", they mean a logo, a colour palette, maybe a nicer website. Useful things — but they’re the label on the jar, not what’s in it.',
          'A brand is the set of associations that fire in someone’s head when they encounter you: what you cost, who you’re for, whether you can be trusted, how it feels to deal with you. It exists in your market’s memory, not in your style guide.',
        ],
      },
      {
        heading: 'You already have one',
        paragraphs: [
          'The uncomfortable part: you have a brand whether you built one or not. If your photos are inconsistent, your tone changes weekly, and your last post is from March, that is the brand — it says "small, sporadic, maybe unreliable" regardless of how good the actual work is.',
          'Branding is simply taking control of those associations instead of letting them accumulate by accident.',
        ],
      },
      {
        heading: 'What actually builds it',
        paragraphs: [
          'Distinctiveness: looking and sounding recognisably like yourself, everywhere, every time. Consistency: the same promise kept across months, not a rebrand every quarter. Evidence: work shown, clients named, results stated plainly.',
          'The visual identity matters because it makes all of that recognisable at a glance. That’s the logo’s real job — not to be a brand, but to remind people of the one you’ve built.',
        ],
        callout:
          'Design makes a brand recognisable. Behaviour makes it worth recognising.',
      },
    ],
  },
  {
    slug: 'before-you-run-ads',
    title: 'Three things to fix before you spend a dollar on ads',
    standfirst:
      'Ads amplify what’s already there. If what’s there is broken, you’re paying to show more people the problem.',
    date: 'May 2026',
    readMins: 4,
    sections: [
      {
        paragraphs: [
          'Paid advertising is the fastest way to scale a business — and the fastest way to torch a budget. The difference is rarely the targeting or the platform. It’s what the click lands on.',
          'Before any campaign goes live, three things need to be true.',
        ],
      },
      {
        heading: '1. The offer is specific',
        paragraphs: [
          '"Contact us for a quote" is not an offer. A first consult with a stated outcome, a package with a named price, a booking link with available times — these are offers. Ads sell a next step, and vague next steps don’t convert at any budget.',
        ],
      },
      {
        heading: '2. The landing experience matches',
        paragraphs: [
          'The ad promises one thing; the page must deliver exactly that thing, fast, on a phone. Every mismatch — different wording, slow load, a homepage instead of the specific page — leaks paid traffic you already bought.',
        ],
      },
      {
        heading: '3. Proof exists and is visible',
        paragraphs: [
          'Cold traffic doesn’t know you. Reviews, named clients, before-and-afters, real photography instead of stock — proof is what lets a stranger take the risk. Without it, the click happens and the enquiry doesn’t.',
        ],
        callout:
          'Fix the offer, the landing, and the proof, and ads become an accelerant. Skip them, and ads become the most efficient money-losing machine you’ll ever build.',
      },
    ],
  },
  {
    slug: 'local-playbook',
    title: 'The local playbook: from invisible to in demand',
    standfirst:
      'For a local business, marketing isn’t a national campaign problem. It’s a "known in the right five suburbs" problem — which is far more winnable.',
    date: 'April 2026',
    readMins: 5,
    sections: [
      {
        paragraphs: [
          'Local businesses have an advantage most brands would kill for: the market is small enough to actually saturate. You don’t need a million people to know you. You need a few thousand of the right ones.',
        ],
      },
      {
        heading: 'Own your ground first',
        paragraphs: [
          'Complete and actively manage your Google Business Profile — reviews, photos, posts, replies. For most local searches, that profile is your real homepage. A steady stream of recent reviews with thoughtful replies outranks almost anything else you could do this quarter.',
        ],
      },
      {
        heading: 'Look like the place people already go',
        paragraphs: [
          'Real photography of your actual space, team, and work — not stock — is the single biggest visual upgrade a local business can make. People choose the venue, clinic, or tradie that looks established and busy. Content’s job locally is to make you look like the obvious, safe, known choice.',
        ],
      },
      {
        heading: 'Be seen in the same small pond, repeatedly',
        paragraphs: [
          'Geo-targeted social content, a modest always-on ad budget within your radius, partnerships with neighbouring businesses, showing up at and hosting local events. None of it is glamorous; all of it compounds, because the same faces keep seeing you.',
        ],
        callout:
          'A local brand is built on repetition inside a small radius. Being everywhere in five suburbs beats being occasional everywhere.',
      },
    ],
  },
  {
    slug: 'voice-that-scales',
    title: 'A voice that scales: sounding like yourself at volume',
    standfirst:
      'The founder’s voice is usually the brand’s best asset — and the hardest thing to keep as the team grows.',
    date: 'March 2026',
    readMins: 4,
    sections: [
      {
        paragraphs: [
          'In the early days, every caption, email, and proposal comes from the founder, and it all sounds coherent because it’s all one person. Then the business grows, hands touch the content, and the voice quietly dissolves into polite, interchangeable marketing-speak.',
          'Audiences notice. Not consciously — they just stop feeling anything.',
        ],
      },
      {
        heading: 'Write the voice down',
        paragraphs: [
          'A usable voice guide is one page, not forty: how you talk (short sentences? dry humour? direct?), the words you use and the ones you never would, three example captions in-voice and one rewritten from out-of-voice. Concrete examples beat adjectives — "confident but warm" means nothing at 9pm to a tired editor.',
        ],
      },
      {
        heading: 'Source from the founder, produce with the team',
        paragraphs: [
          'The scalable model isn’t the founder writing everything — it’s the founder generating raw material (voice notes, interviews, hot takes on a shoot day) that the team shapes into finished content. The thinking stays authentic; the production stays consistent.',
        ],
        callout:
          'People buy from people. A voice that survives scaling is the difference between a brand and a content account.',
      },
    ],
  },
  {
    slug: 'looking-cheaper',
    title: 'The cost of looking cheaper than you charge',
    standfirst:
      'When your prices say premium and your presence says budget, the buyer believes the presence.',
    date: 'March 2026',
    readMins: 4,
    sections: [
      {
        paragraphs: [
          'Every service business has felt it: the enquiry that goes quiet after the quote. The usual diagnosis is "they couldn’t afford it". The more common truth is that the price didn’t match the picture.',
          'Buyers can’t see your process, your experience, or your standards before they buy. They price you on what they can see — the photos, the website, the feed, the proposal document. When those look DIY, a premium quote feels like a mistake, or worse, a gouge.',
        ],
      },
      {
        heading: 'The congruence test',
        paragraphs: [
          'Put your price next to your Instagram grid and your website on one screen. Would a stranger guess the number within 20 per cent? If your visuals suggest $500 and your quote says $5,000, the gap is costing you jobs you were qualified for.',
        ],
      },
      {
        heading: 'Presentation is pricing infrastructure',
        paragraphs: [
          'Professional photography, a coherent visual identity, and a proposal that looks considered aren’t vanity spend — they’re what makes your price believable before you’ve said a word. The businesses that charge the most in any market are rarely the best. They’re the ones whose presence makes their price feel obvious.',
        ],
        callout:
          'You don’t get paid what you’re worth. You get paid what you can visibly justify.',
      },
    ],
  },
  {
    slug: 'partner-vs-freelancers',
    title: 'One partner vs five freelancers: the real math on a scattered setup',
    standfirst:
      'The freelancer patchwork looks cheaper on paper. The invoice never shows the coordination tax.',
    date: 'February 2026',
    readMins: 5,
    sections: [
      {
        paragraphs: [
          'A photographer here, a social manager there, a designer on Fiverr, an ads guy from a Facebook group, and you in the middle — briefing, chasing, approving, and gluing it all together. Each line item looks reasonable. The system as a whole quietly costs more than the retainer you were avoiding.',
        ],
      },
      {
        heading: 'The costs that never hit an invoice',
        paragraphs: [
          'Your hours: every handover, re-brief, and revision cycle runs through you, and your time is the most expensive in the business. Inconsistency: five specialists produce five slightly different versions of your brand, and the audience sees the seams. Latency: a campaign that needs photo, copy, and ads coordinated across three calendars ships weeks late — or in pieces.',
        ],
      },
      {
        heading: 'What one team changes',
        paragraphs: [
          'When strategy, shooting, editing, and distribution sit with one crew, the brief happens once. The photographer knows what the ad needs; the editor knows the voice; the strategist sees the numbers. Work compounds instead of fragmenting.',
          'Freelancers are the right call for genuine one-offs. But if content is meant to be your growth engine, the engine shouldn’t be assembled fresh every month by the busiest person in the company.',
        ],
        callout:
          'Count your own hours in the freelancer math. For most owners, that line alone flips the comparison.',
      },
    ],
  },
  {
    slug: 'week-from-one-shoot',
    title: 'A week of content from one shoot: how batching actually works',
    standfirst:
      'The businesses that seem to be everywhere aren’t shooting constantly. They’re extracting more from each shoot than you are.',
    date: 'February 2026',
    readMins: 4,
    sections: [
      {
        paragraphs: [
          'The maths of content only works one way: production has to be batched. Here’s what a single well-planned half-day shoot actually yields when it’s designed for extraction rather than a single deliverable.',
        ],
      },
      {
        heading: 'Plan for outputs, not shots',
        paragraphs: [
          'Before anyone picks up a camera, the shot list is written backwards from the calendar: two long-form videos, six short clips, fifteen photos, one set of team portraits, b-roll for future edits. Every setup on the day exists because a scheduled post needs it.',
        ],
      },
      {
        heading: 'One setup, many angles',
        paragraphs: [
          'A ten-minute interview answer becomes a long-form cut, three vertical clips with captions, a quote graphic, and the intro of next month’s email. The same lighting setup shoots the portraits and the product details. Nothing is torn down until it has produced everything it can.',
        ],
      },
      {
        heading: 'The drip does the rest',
        paragraphs: [
          'Edited and loaded into the calendar, that half-day covers three to four weeks of consistent posting — which is how a busy business stays visible without content ever becoming the owner’s second job.',
        ],
        callout:
          'Shoot monthly, publish weekly, appear daily. That’s the whole trick.',
      },
    ],
  },
]

export const getArticle = (slug: string) => articles.find(a => a.slug === slug)
