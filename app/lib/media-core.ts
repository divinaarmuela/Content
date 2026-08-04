/**
 * Pure media helpers — no imports, safe in the browser.
 *
 * These lived in websiteData.ts, which builds a Supabase client (with the
 * service-role key) at module load. Importing a one-line regex from there
 * dragged that client into the client bundle, and since the service-role key
 * is correctly absent in the browser, `createClient` threw
 * "supabaseKey is required" the moment any client component rendered.
 *
 * Keeping pure helpers physically apart from anything that touches the
 * database is what stops that happening again: there is nothing here to drag.
 */

/** Does this URL point at a video rather than an image? */
export const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url)
