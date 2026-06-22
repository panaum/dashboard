/** Minimal RFC-4180 CSV builder with Excel-safe quoting. */
export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    // Neutralise spreadsheet formula injection: a cell beginning with = + - @
    // (or tab/CR) can execute when opened in Excel/Sheets. Prefix a quote — but
    // only on non-numeric cells, so real numbers like a "-3" delay stay numeric.
    if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows]
    .map((r) => r.map(esc).join(","))
    .join("\r\n");
}

/** Build a downloadable CSV Response (UTF-8 BOM so Excel reads accents right). */
export function csvResponse(csv: string, filename: string): Response {
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
