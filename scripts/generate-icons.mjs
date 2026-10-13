import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Export the selected raster artwork without changing its proportions.
const publicDir = new URL('../public/', import.meta.url);
const source = fileURLToPath(new URL('brand/book-dialogue.png', publicDir));
const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) {
  const png = await sharp(source).resize(size, size, { fit: 'contain', background: {r:0,g:0,b:0,alpha:0} }).png().toBuffer();
  images.push(png);
  await writeFile(new URL(`favicon-${size}.png`, publicDir), png);
}
await sharp(source).resize(180, 180).png().toFile(fileURLToPath(new URL('apple-touch-icon.png', publicDir)));

// ICO container with PNG entries for standard and high-density browser tabs.
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  header[entry] = sizes[i];
  header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
}
await writeFile(new URL('favicon.ico', publicDir), Buffer.concat([header, ...images]));
console.log('Exported 16/32/48 px favicons, multi-size ICO and 180 px touch icon.');
