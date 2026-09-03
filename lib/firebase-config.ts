/**
 * Public Firebase web config. Public by design (it is shipped to browsers);
 * the database is protected by rules, not by hiding these. Read lazily so a
 * missing variable fails the request that needs it, never the build.
 *
 * EVERY `process.env.NEXT_PUBLIC_*` BELOW IS WRITTEN OUT IN FULL, ON PURPOSE.
 * The bundler inlines these by TEXTUAL SUBSTITUTION: it looks for the literal
 * `process.env.NEXT_PUBLIC_FIREBASE_API_KEY` and replaces it with the value.
 * A dynamic lookup — `process.env[name]` — matches nothing, so it survives
 * into the browser bundle as a read of an object that is empty there, and
 * every variable reads as undefined. On the server that indirection worked
 * perfectly, which is exactly why it went unnoticed until the browser started
 * reading the database: the boards died on "NEXT_PUBLIC_FIREBASE_API_KEY is
 * not set" with the key sitting right there in `.env.local`.
 */
function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export function firebaseConfig() {
  return {
    apiKey: need('NEXT_PUBLIC_FIREBASE_API_KEY', process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: need('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: need('NEXT_PUBLIC_FIREBASE_PROJECT_ID', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    appId: need('NEXT_PUBLIC_FIREBASE_APP_ID', process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
    databaseURL: rtdbUrl(),
  }
}

/** Realtime Database origin, no trailing slash. */
export function rtdbUrl(): string {
  return need('NEXT_PUBLIC_FIREBASE_DATABASE_URL', process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
    .replace(/\/+$/, '')
}
