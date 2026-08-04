import 'server-only'

/**
 * Translate database errors that really mean "a migration has not been run".
 *
 * PostgREST answers a missing table with "Could not find the table
 * 'public.x' in the schema cache", which surfaced in the dashboard verbatim
 * and reads like a bug in the app. It is not — it is a setup step, and the
 * message should say which file to run.
 *
 * Anything unrecognised is passed through untouched: inventing a friendly
 * message for an error we do not understand hides real failures.
 */
export function explainDbError(message: string, migration: string): string {
  const missingTable =
    message.includes('schema cache') ||
    /relation .* does not exist/i.test(message)

  if (missingTable) {
    return `This needs supabase/${migration} — run it once in the Supabase SQL editor.`
  }

  const missingColumn = /column .* does not exist/i.test(message)
  if (missingColumn) {
    return `The database is missing a column this page needs — re-run supabase/${migration}; it is safe to run again.`
  }

  return message
}
