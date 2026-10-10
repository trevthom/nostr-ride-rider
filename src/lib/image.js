// ════════════════════════════════════════════════════════════
//  IMAGE — Read an uploaded file and shrink it to a small JPEG data
//  URL that fits inside a Nostr profile event (kind 0). We iterate
//  down on quality, then dimension, until the encoded string is under
//  a conservative byte budget so relays don't reject the event.
// ════════════════════════════════════════════════════════════

function render(srcDataUrl, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Couldn't load the image."));
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = srcDataUrl;
  });
}

// maxBytes caps the resulting data-URL string length. ~20 KB keeps a
// two-image profile event comfortably under common relay caps.
export async function resizeImage(file, maxDim = 200, quality = 0.6, maxBytes = 20000) {
  const srcDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  let dim = maxDim;
  let q = quality;
  let out = await render(srcDataUrl, dim, q);

  // Shrink until under budget: drop quality first, then dimensions.
  let guard = 0;
  while (out.length > maxBytes && guard++ < 12) {
    if (q > 0.35) q -= 0.1;
    else { dim = Math.round(dim * 0.85); q = 0.5; }
    if (dim < 64) break;
    out = await render(srcDataUrl, dim, q);
  }
  return out;
}
