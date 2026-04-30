import sharp from 'sharp';

export async function bufferToWebpDataUri(buf: Buffer, quality: number): Promise<string> {
  const webp = await sharp(buf).webp({ quality }).toBuffer();
  return `data:image/webp;base64,${webp.toString('base64')}`;
}

const IMG_DATA_URI_RE = /data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/]+=*)/g;

export interface CompressHtmlImagesOpts {
  imageQuality: number;
  // Each pattern is matched against the raw HTML and removed before image rewriting.
  // Use multi-line patterns with the `g` flag to drop entire DOM regions
  // (e.g. Lighthouse's filmstrip block).
  stripPatterns?: RegExp[];
}

export async function compressHtmlImages(
  html: Buffer,
  opts: CompressHtmlImagesOpts,
): Promise<Buffer> {
  let text = html.toString('utf8');

  if (opts.stripPatterns) {
    for (const pattern of opts.stripPatterns) {
      text = text.replace(pattern, '');
    }
  }

  const matches = [...text.matchAll(IMG_DATA_URI_RE)];
  if (matches.length === 0) return Buffer.from(text, 'utf8');

  const replacements = await Promise.all(
    matches.map(async (m) => {
      const original = m[0];
      const base64 = m[1];
      try {
        const buf = Buffer.from(base64, 'base64');
        const webp = await bufferToWebpDataUri(buf, opts.imageQuality);
        return { original, webp };
      } catch {
        return { original, webp: original };
      }
    }),
  );

  // Replace from the end so earlier offsets don't shift.
  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const { webp } = replacements[i];
    if (webp === m[0]) continue;
    out = out.slice(0, m.index!) + webp + out.slice(m.index! + m[0].length);
  }

  return Buffer.from(out, 'utf8');
}
