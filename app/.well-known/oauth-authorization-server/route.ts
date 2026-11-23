import { authorizationServerMetadataHandler, metadataCorsHandler } from '@clerk/mcp-tools/next'

// for older connectors that look for the sign-in server at the site's root
const handler = authorizationServerMetadataHandler()
const corsHandler = metadataCorsHandler()

export { handler as GET, corsHandler as OPTIONS }
