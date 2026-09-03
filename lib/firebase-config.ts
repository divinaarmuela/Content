/**
 * Public Firebase web config. Public by design (it is shipped to browsers);
 * the database is protected by rules, not by hiding these. Read lazily so a
 * missing variable fails the request that needs it, never the build.
 */
function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set`)
  return v
}

export function firebaseConfig() {
  return {
    apiKey: need('NEXT_PUBLIC_FIREBASE_API_KEY'),
    authDomain: need('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: need('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    appId: need('NEXT_PUBLIC_FIREBASE_APP_ID'),
    databaseURL: rtdbUrl(),
  }
}

/** Realtime Database origin, no trailing slash. */
export function rtdbUrl(): string {
  return need('NEXT_PUBLIC_FIREBASE_DATABASE_URL').replace(/\/+$/, '')
}
