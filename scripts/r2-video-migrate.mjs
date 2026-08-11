// One-off: list the R2 asset bucket and upload marketing videos from public/.
// Usage: node scripts/r2-video-migrate.mjs [--upload]
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync, statSync } from 'node:fs'
import { config } from 'dotenv'

config({ path: '.env.local' })

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const bucket = process.env.R2_BUCKET
console.log('bucket:', bucket)
console.log('public base:', process.env.R2_PUBLIC_BASE_URL)
console.log('asset url:', process.env.NEXT_PUBLIC_ASSET_URL)

const list = await client.send(new ListObjectsV2Command({ Bucket: bucket }))
const existing = new Set((list.Contents ?? []).map(o => o.Key))
console.log('\nexisting objects:')
for (const o of list.Contents ?? []) {
  if (o.Key.endsWith('.mp4')) console.log(` ${(o.Size / 1e6).toFixed(1)}MB  ${o.Key}`)
}

if (process.argv.includes('--upload')) {
  const files = [
    'cecconis.mp4', 'Automodellista.mp4', 'Pattons.mp4', 'Senorita.mp4',
    'website-landscape.mp4', 'strategy-waterside.mp4', 'hero-divina.mp4',
    'jason-hero.mp4',
  ]
  for (const f of files) {
    if (existing.has(f)) { console.log(`skip (exists): ${f}`); continue }
    const body = readFileSync(`public/${f}`)
    console.log(`uploading ${f} (${(statSync(`public/${f}`).size / 1e6).toFixed(1)}MB)…`)
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: f, Body: body, ContentType: 'video/mp4',
      CacheControl: 'public, max-age=31536000, immutable',
    }))
  }
  console.log('done')
}
