import sharp from 'sharp';

// User-approved technical cutout of the selected white-backed raster artwork.
// Pass the original artwork, never the already processed output.
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/prepare-logo.mjs <original-white-background.png>');
const {data,info} = await sharp(input).removeAlpha().raw().toBuffer({resolveWithObject:true});
const rgba = Buffer.alloc(info.width * info.height * 4);
const shift = Math.round(info.height * 0.04);
for (let y=0; y<info.height-shift; y++) {
  for (let x=0; x<info.width; x++) {
    const src=(y*info.width+x)*info.channels;
    // Recover edge coverage against white, then remove white contamination.
    const coverage=Math.min(1, Math.max(0, (255-data[src])/(255-56)));
    const alpha=coverage<0.06?0:coverage>0.94?255:Math.round(coverage*255);
    const dst=((y+shift)*info.width+x)*4;
    rgba[dst]=56; rgba[dst+1]=111; rgba[dst+2]=85; rgba[dst+3]=alpha;
  }
}
await sharp(rgba,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile('public/brand/book-dialogue.png');
console.log('Preserved raster outline, removed white matte and shifted downward by 4%.');
