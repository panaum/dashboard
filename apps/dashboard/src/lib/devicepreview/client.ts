import "server-only";

// Server-only access to the devicepreview service. The key is read here and
// in the API proxy routes and never leaves the server; the browser only ever
// talks to our own /api/devicepreview/* routes.

export function devicePreviewConfigured(): boolean {
  return Boolean(process.env.DEVICEPREVIEW_URL && process.env.DEVICEPREVIEW_KEY);
}

export function devicePreviewBase(): string {
  return (process.env.DEVICEPREVIEW_URL || "").replace(/\/$/, "");
}

export function devicePreviewHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.DEVICEPREVIEW_KEY || ""}` };
}
