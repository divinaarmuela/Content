import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pdfkit ships its font metrics (.afm) as data files and resolves them via
  // runtime paths. Bundling rewrites those paths (producing errors like
  // "ENOENT ... C:\ROOT\...\Helvetica.afm"), so keep it external and let it
  // load from node_modules normally.
  serverExternalPackages: ['pdfkit'],

  // content.mdmmarketing.com.au is a legacy alias of this same project (the
  // Linktree still points at it) — send it to the canonical site instead of
  // serving a duplicate homepage
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'content.mdmmarketing.com.au' }],
        destination: 'https://www.mdmmarketing.com.au/:path*',
        permanent: true,
      },
      // the studio pitch now lives with events
      { source: '/podcast-studio', destination: '/events', permanent: true },
    ]
  },
}

export default nextConfig
