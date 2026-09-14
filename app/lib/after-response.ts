import { after } from 'next/server'

/**
 * WORK THAT MUST OUTLIVE THE RESPONSE — an email, a fan-out — without ever
 * holding the response up.
 *
 * `after()` rather than a bare `void promise`: a serverless function that
 * has already sent its response can be frozen mid-flight, and a promise
 * nobody awaits is the first thing frozen. The transition emails were such
 * a promise: several database round trips and a send, started as the write
 * returned, and the owner's quality checker heard nothing (14 Sep 2026:
 * "just sent an edit for a quality review, but the quality person did not
 * get the email"). `after()` is Next's own way of saying "run this once the
 * response is out, and stay alive for it".
 *
 * Outside a request — a test, an Inngest step, a script — there is no scope
 * for `after()` to attach to and it throws at once; the work then runs
 * detached, as it always did. Either way it is never awaited by the caller
 * and a failure is logged under its label, never thrown.
 */
export function afterResponse(label: string, run: () => Promise<unknown>): void {
  const job = async () => {
    try {
      await run()
    } catch (e) {
      console.error(`${label} error:`, e)
    }
  }
  try {
    after(job)
  } catch {
    void job()
  }
}
