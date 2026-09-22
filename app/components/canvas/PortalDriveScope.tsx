'use client'

import { createContext, useContext } from 'react'
import type { PortalDriveScope } from '../../lib/canvas-drive-core'

/**
 * WHICH BOARD THE CLIENT IS LOOKING AT, for the Drive files on it (22 Sep
 * 2026). The client's page wraps the canvas in this; a post frame reads it
 * and asks the client's Drive route (/api/portal/drive) for the file's
 * picture and bytes, behind the token and pinned to this board. The
 * dashboard provides nothing and its frames use the team's own proxies.
 */
const Ctx = createContext<PortalDriveScope | null>(null)
export const PortalDriveScopeProvider = Ctx.Provider
export function usePortalDriveScope(): PortalDriveScope | null {
  return useContext(Ctx)
}
