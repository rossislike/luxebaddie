// Derives every brand asset the storefront uses from the source artwork in /images.
// Run with `pnpm --filter @luxebaddie/web brand` after the artwork changes, and commit the output.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");

const source = {
  logo: path.join(repoRoot, "images/LuxeBaddie3.jpeg"),
  studioSign: path.join(repoRoot, "images/LuxeBaddie1.jpeg"),
  goldLockup: path.join(repoRoot, "images/LuxeBaddie2.jpeg"),
};

const output = {
  logoMark: path.join(webRoot, "src/brand/logo-mark.png"),
  studioSign: path.join(webRoot, "src/brand/studio-sign.jpg"),
  favicon: path.join(webRoot, "src/app/icon.png"),
  appleIcon: path.join(webRoot, "src/app/apple-icon.png"),
  shareImage: path.join(webRoot, "src/app/opengraph-image.jpg"),
  repoIcon: path.join(repoRoot, "assets/icon.png"),
};

const INK = { r: 0x17, g: 0x11, b: 0x0f }; // --color-ink in globals.css
const ROSE_GOLD = { r: 205, g: 181, b: 167 }; // the line colour of the logo artwork

// The logo artwork is light line art on an uneven dark backdrop. Brightness at or
// below BACKDROP is treated as backdrop, at or above LINE as solid line, and the
// range between becomes the soft edge.
const BACKDROP_BRIGHTNESS = 80;
const LINE_BRIGHTNESS = 150;
const UPSCALE = 3; // the artwork is small; enlarging before cutting out keeps edges smooth

/** The logo's line art alone, on a transparent background, trimmed to its edges. */
async function cutOutLogoMark() {
  const { width, height } = await sharp(source.logo).metadata();
  const brightness = await sharp(source.logo)
    .resize(width * UPSCALE, height * UPSCALE, { kernel: "lanczos3" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const range = LINE_BRIGHTNESS - BACKDROP_BRIGHTNESS;
  const alpha = Buffer.from(brightness.data.map((value) => clampToByte(((value - BACKDROP_BRIGHTNESS) / range) * 255)));

  const { width: w, height: h } = brightness.info;
  return sharp({ create: { width: w, height: h, channels: 3, background: ROSE_GOLD } })
    .joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer()
    .then((cutOut) => sharp(cutOut).trim().png().toBuffer());
}

const clampToByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

/** A square icon: the logo mark centred on the brand's dark ink. */
async function squareIcon(logoMark, size) {
  const markHeight = Math.round(size * 0.8);
  const mark = await sharp(logoMark).resize({ height: markHeight }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: INK } })
    .composite([{ input: mark, gravity: "centre" }])
    .png();
}

async function main() {
  await Promise.all(Object.values(output).map((file) => mkdir(path.dirname(file), { recursive: true })));

  const logoMark = await cutOutLogoMark();
  await sharp(logoMark).resize({ height: 720 }).png({ compressionLevel: 9 }).toFile(output.logoMark);

  await (await squareIcon(logoMark, 192)).toFile(output.favicon);
  await (await squareIcon(logoMark, 180)).toFile(output.appleIcon);
  await (await squareIcon(logoMark, 256)).toFile(output.repoIcon);

  await sharp(source.studioSign).jpeg({ quality: 82, mozjpeg: true }).toFile(output.studioSign);
  // 1200x630 is the size social networks expect for link previews.
  await sharp(source.goldLockup).resize(1200, 630, { fit: "cover" }).jpeg({ quality: 85, mozjpeg: true }).toFile(output.shareImage);
}

await main();
