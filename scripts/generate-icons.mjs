// Run with node scripts/generate-icons.mjs after replacing the official logo.
// sharp is supplied by Next.js; generated assets are committed, not built at runtime.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = new URL('../public/av-jewelry-logo.png', import.meta.url);
const background = '#0c0f0d';
async function png(size, inset = 0) {
  const logo = await sharp(fileURLToPath(source))
    .resize(size - inset * 2, size - inset * 2)
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([{ input: logo, left: inset, top: inset }])
    .png()
    .toBuffer();
}

for (const [name, size, inset] of [
  ['favicon-16x16.png', 16, 0],
  ['favicon-32x32.png', 32, 0],
  ['favicon-96x96.png', 96, 0],
  ['apple-touch-icon.png', 180, 11],
  ['icon-192x192.png', 192, 0],
  ['icon-512x512.png', 512, 0],
  ['icon-maskable-512x512.png', 512, 76],
]) {
  await writeFile(new URL(`../public/${name}`, import.meta.url), await png(size, inset));
}

// Multi-resolution ICO with PNG frames supported by modern desktop browsers.
const sizes = [16, 32, 48, 256];
const frames = await Promise.all(sizes.map((size) => png(size)));
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = sizes[index] % 256;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frame.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(
  new URL('../src/app/favicon.ico', import.meta.url),
  Buffer.concat([directory, ...frames]),
);
