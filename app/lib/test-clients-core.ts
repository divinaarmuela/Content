/**
 * TEST CLIENTS NEVER EMAIL A REAL PERSON (the owner, 30 Sep 2026: "don't test with real client" and "did anyone
 * get notified"). Testing a button on a test client's post must not reach Joy, a manager or a client: a move like
 * "Send for quality check" tells EVERY quality checker, whoever the client is.
 *
 * So a notification about a test client's work goes only to a test address; to anyone else it is muted. Pure: the
 * wrapper (mailer.notify) looks up which client the email is about and asks here.
 */

/** 100 Hundred Million Group, ZZ E2E Test Client, ZZ TEST - Workflow (do not touch). */
export const TEST_CLIENT_IDS: readonly string[] = [
  '459e2564-1089-45ed-abd7-56d5f53c2cf6',
  'd59d3fb2-c775-4782-b966-d61700a5de93',
  '99ba2c6f-4db5-4782-9395-9048f215886c',
]

/** Addresses that may be emailed about a test client: the owner's test inbox and the testing super admin. */
export const TEST_ADDRESSES: readonly string[] = ['akmalashwin23@gmail.com', 'tech@mdmmarketing.com.au']

export function isTestClient(clientId: string | null | undefined): boolean {
  return !!clientId && TEST_CLIENT_IDS.includes(clientId)
}

/** A team account made for testing: its name starts "Test " (Test Scheduler, Test Account Manager, Test Editor). */
export function isTestPerson(person: { name?: string | null } | null | undefined): boolean {
  return /^test\s/i.test(String(person?.name ?? '').trim())
}

/**
 * May this email go? Always, unless it is about a test client — then only to a test address or a test account.
 */
export function mayEmailAboutClient(
  clientId: string | null | undefined,
  recipient: { email: string; person?: { name?: string | null } | null },
): boolean {
  if (!isTestClient(clientId)) return true
  if (TEST_ADDRESSES.includes(recipient.email.trim().toLowerCase())) return true
  return isTestPerson(recipient.person)
}

/** The table that holds each kind of thing an email is about, where that row carries its `client_id`. */
export const CLIENT_OF_ENTITY: Readonly<Record<string, string>> = {
  content_item: 'content_items',
  social_post: 'social_posts',
  publish_job: 'publish_jobs',
  intake_form: 'intake_forms',
  schedule_note: 'schedule_notes',
  batch: 'batches',
  booking: 'bookings',
  shoot_proposal: 'shoot_proposals',
  deliverable_group: 'deliverable_groups',
  item_comment: 'item_comments',
  client_agreement: 'client_agreements',
  monthly_update: 'monthly_updates',
}
