import { metadataCorsHandler, protectedResourceMetadataHandler } from '@clerk/mcp-tools/next'
import { mcpAuthOptions } from '@/app/lib/mcp-options'

// where a connector learns which sign-in server guards /mcp
const handler = protectedResourceMetadataHandler(mcpAuthOptions)
const corsHandler = metadataCorsHandler()

export { handler as GET, corsHandler as OPTIONS }
