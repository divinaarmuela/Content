import { landingMeta } from '../meta'
import HospitalityPage from '../../services/hospitality/page'
import '../landing.css'

/** /landing/hospitality: the hospitality page for ads, out of search (owner, 11 Nov 2026: "hospitality needs a copy
 *  too"), in the landing pages' dark theme ("just make a nice dark theme"). Bookings show "Booked from: /landing/hospitality". */
export const metadata = landingMeta('Hospitality marketing', 'Content, social and ads that fill Melbourne venues.')

export default function Page() {
  return <HospitalityPage />
}
