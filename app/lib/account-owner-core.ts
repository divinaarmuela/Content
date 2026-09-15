/**
 * WHOSE ACCOUNT IS THIS? (the owner, 15 Sep 2026: "sometimes we are
 * connecting their personal account" — "so: master social channel client,
 * and underneath the client name and their accounts too").
 *
 * A connection belongs to a client, and — when it is somebody's own page
 * rather than the company's — to one of the client's contacts
 * (`social_accounts.contact_id`). The Accounts page draws the company first,
 * then each person with their own accounts under them, so "Instagram ·
 * @justin_engelke" reads as Justin's, not the company's. Pure: the page and
 * the route hand rows in and get sections and choices out.
 */
export type OwnedAccount = { id: string; contact_id?: string | null; platform: string; name?: string | null; username?: string | null }
export type Contact = { id: string; name: string; role?: string | null; is_primary?: boolean | null }

export type OwnerSection<A extends OwnedAccount = OwnedAccount> = {
  /** 'company', or the contact's id */
  key: string
  title: string
  hint: string
  accounts: A[]
}

/** Contacts in the order the page lists them: the primary first, then by name. */
export function contactsInOrder<C extends Contact>(contacts: readonly C[]): C[] {
  return [...contacts].sort((a, b) =>
    Number(b.is_primary === true) - Number(a.is_primary === true) || a.name.localeCompare(b.name))
}

/**
 * The company's accounts, then each contact's. A section is drawn only when
 * it has an account — except the company's, which is always there, so an
 * empty client still says where its official pages will go. An account whose
 * contact is gone falls back to the company.
 */
export function accountSections<A extends OwnedAccount>(
  clientName: string, accounts: readonly A[], contacts: readonly Contact[],
): OwnerSection<A>[] {
  const known = new Set(contacts.map(c => c.id))
  const ofCompany = accounts.filter(a => !a.contact_id || !known.has(a.contact_id))
  const out: OwnerSection<A>[] = [{
    key: 'company', title: clientName, hint: 'The official business accounts', accounts: ofCompany,
  }]
  for (const c of contactsInOrder(contacts)) {
    const theirs = accounts.filter(a => a.contact_id === c.id)
    if (theirs.length === 0) continue
    out.push({
      key: c.id,
      title: c.name,
      hint: `${possessive(c.name)} personal accounts${c.role ? ` · ${c.role}` : ''}`,
      accounts: theirs,
    })
  }
  return out
}

/** The choices on an account's "Whose account is this?" picker. */
export function ownerChoices(clientName: string, contacts: readonly Contact[]): { value: string; label: string }[] {
  return [
    { value: 'company', label: `${clientName} — the official business account` },
    ...contactsInOrder(contacts).map(c => ({ value: c.id, label: `${c.name} — their personal account` })),
  ]
}

/** One line under an account, saying whose it is. */
export function ownerLabel(account: OwnedAccount, clientName: string, contacts: readonly Contact[]): string {
  const c = account.contact_id ? contacts.find(x => x.id === account.contact_id) : null
  return c ? `${possessive(c.name)} personal account` : `${clientName} business account`
}

/** "Justin's", "James's" — the plain possessive; a name is never made grammatical by force. */
export function possessive(name: string): string {
  const n = name.trim()
  return n.endsWith('s') ? `${n}’` : `${n}’s`
}

/** What the picker's value means for the row: null for the company, the id for a person. */
export function contactIdOf(choice: string | null | undefined): string | null {
  const v = String(choice ?? '').trim()
  return v && v !== 'company' ? v : null
}
