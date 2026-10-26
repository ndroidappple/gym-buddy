/* A meal photo, shrunk on the phone before it goes to the coach: a phone camera's 4,000 px photo is
   several MB, and the API takes 4.5 MB a request. 1280 px on the long side keeps the scale's digits
   sharp (they're a small part of the shot) at a few hundred KB as JPEG. */

const MAX = 1280;
const QUALITY = 0.82;

/** An <img> for a file, for browsers whose createImageBitmap can't read it. */
const imageOf = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
  img.src = url;
});

/** A picked or taken photo as { url, data, mediaType }: url to show it, data (base64) to send it. */
export async function shrinkPhoto(file) {
  // Both honor the photo's EXIF rotation, so a portrait shot stays upright.
  const src = await createImageBitmap(file).catch(() => imageOf(file));
  const w = src.width, h = src.height;
  const k = Math.min(1, MAX / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext("2d").drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  const url = canvas.toDataURL("image/jpeg", QUALITY);
  return { url, data: url.slice(url.indexOf(",") + 1), mediaType: "image/jpeg" };
}
