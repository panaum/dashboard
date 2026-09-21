// Browser-only. A pasted full-screen grab is 1–4 MB of PNG; a Next server
// action refuses a body over its limit (the default 1 MB surfaces as a bare
// "A server error occurred", with "Body exceeded 1 MB limit" only in the
// server log), and a row that size sits in Postgres forever on a free tier
// with no object store.
//
// So every screenshot is re-encoded here before it is sent: capped on the
// long edge and written as WebP. A 2940×1912 PNG lands around 200 KB with no
// visible loss for reading a UI bug. The size cap in the action stays as the
// backstop for what this cannot handle.

const MAX_EDGE = 2000;
const QUALITY = 0.9;

export async function prepareImage(file: File, maxEdge = MAX_EDGE): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // GIFs are usually animated; re-encoding would silently drop the animation.
  if (file.type === "image/gif") return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // not decodable here — let the server judge it
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) { bitmap.close?.(); return file; }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/webp", QUALITY));
  // Re-encoding a small screenshot can come out bigger than the original;
  // when it does, the original is the better thing to store.
  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, "") || "screenshot";
  return new File([blob], `${name}.webp`, { type: "image/webp" });
}
