/**
 * A WAIT WITH AN END.
 *
 * The owner, 9 Sep 2026: "any time I'm on this modal it's broken — editing
 * the video, image etc, I can't save my thing and it's stuck, I can't click
 * discard even." A save that awaited an upload promise which never settled
 * (a transfer that neither finished nor failed) held `busy` for ever, and
 * the buttons behind `busy` with it. Every wait behind a button now ends —
 * with the answer, or with a sentence a person can act on.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} is taking too long — check your connection and try again`)), ms)
  })
  return Promise.race([p, late]).finally(() => { if (timer) clearTimeout(timer) }) as Promise<T>
}

export const UPLOAD_WAIT_MS = 90_000
export const SAVE_WAIT_MS = 60_000
