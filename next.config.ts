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
      // the personal-brand pitch now lives on the work page
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'personalbrand.mdmmarketing.com.au' }],
        destination: 'https://www.mdmmarketing.com.au/work',
        permanent: true,
      },
      // the Post approval page, as it is typed from memory (the owner, 9 Sep
      // 2026: "/dashboard/schedular — this page showing an error"). A plain
      // 404 for one letter is a bad answer to somebody who knows the page.
      { source: '/dashboard/schedular', destination: '/dashboard/scheduler', permanent: false },
      { source: '/dashboard/schedular/:path*', destination: '/dashboard/scheduler/:path*', permanent: false },
    ]
  },
}

export default nextConfig
