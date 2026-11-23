import type { McpAuthOptions } from '@clerk/mcp-tools/next'

/**
 * THE CONNECTOR FOR CLAUDE AND CHATGPT (the owner, 23 Nov 2026: "create one for claude and chatgpt … we can ask
 * questions about the posts"). One address, `/mcp`, added as a custom connector in either. Whoever adds it signs in
 * with their own dashboard login, and every answer is read with that person's rights. READ ONLY: no tool here posts,
 * books, edits or deletes.
 *
 * The address is part of the sign-in (a token is only good for the address it was issued to), so it is spelled out.
 */
export const MCP_RESOURCE_URL = process.env.MCP_RESOURCE_URL || 'https://app.mdmmarketing.com.au/mcp'

export const mcpAuthOptions = {
  resourceUrl: MCP_RESOURCE_URL,
  requiredScopes: ['profile', 'email'],
  // not even the list of questions is given to somebody who has not signed in
  discoverable: false,
} satisfies McpAuthOptions
