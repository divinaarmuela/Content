'use client'

import { useCallback } from 'react'
import { useTable } from '@/lib/db-client'
import type { EncodeJob } from '@/lib/db-types'
import { playableUrl } from '../../lib/playable-core'

/**
 * The file a `<video>` on screen should play: the encoder's .mp4 copy of a
 * master when one is finished, the master otherwise (playable-core). Live
 * off `encode_jobs`, so a preview turns playable the moment a copy lands.
 */
export function usePlayable(): (url: string) => string {
  const { rows } = useTable<EncodeJob>('encode_jobs')
  return useCallback((url: string) => playableUrl(url, rows), [rows])
}
