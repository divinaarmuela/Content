import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const inDir = '_optimized/raw';
const outDir = '_optimized/web';
const files = await readdir(inDir);
for (const f of files) {
  if (!/\.(jpe?g|png)$/i.test(f)) continue;
  const src = path.join(inDir, f);
  const out = path.join(outDir, f.replace(/\.(jpe?g|png)$/i, '.jpg'));
  await sharp(src)
    .rotate()                       // respect EXIF orientation
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(out);
  const a = (await stat(src)).size, b = (await stat(out)).size;
  console.log(`${f}: ${(a/1048576).toFixed(1)}MB -> ${(b/1024).toFixed(0)}KB  (${(a/b).toFixed(0)}x smaller)`);
}
