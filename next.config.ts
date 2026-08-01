import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pdfkit ships its font metrics (.afm) as data files and resolves them via
  // runtime paths. Bundling rewrites those paths (producing errors like
  // "ENOENT ... C:\ROOT\...\Helvetica.afm"), so keep it external and let it
  // load from node_modules normally.
  serverExternalPackages: ['pdfkit'],
}

export default nextConfig
