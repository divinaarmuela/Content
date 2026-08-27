import 'server-only'

/**
 * Translate database errors that really mean "a migration has not been run".
 *
 * PostgREST answers a missing table with "Could not find the table
 * 'public.x' in the schema cache", which surfaced in the dashboard verbatim
 * and reads like a bug in the app. It is not — it is a setup step.
 *
 * What changed: the replacement used to name the .sql file, on the theory that
 * whoever saw it could run it. Nobody who sees it can. The person reading is an
 * editor or a scheduler; "run supabase/identity.sql in the SQL editor" teaches
 * them only that the app is broken and that it might be their fault. So the
 * migration name now goes to the SERVER LOG, where a developer will actually
 * look, and the screen gets a sentence a person can act on.
 *
 * Anything unrecognised is still passed through untouched: inventing a friendly
 * message for an error we do not understand hides real failures.
 */
export function explainDbError(message: string, migration: string): string {
  const missingTable =
    message.includes('schema cache') ||
    /relation .* does not exist/i.test(message)

  const missingColumn = /column .* does not exist/i.test(message)

  if (missingTable || missingColumn) {
    console.error(
      `[setup] run supabase/${migration} in the Supabase SQL editor — it is idempotent.`,
      message,
    )
    return 'This part of the app has not been switched on for this workspace yet. Nothing you did caused it — someone on our side has to switch it on.'
  }

  return message
}
