import fs from "node:fs/promises";

const file = "data/tracking-results.json";
const payload = JSON.parse(await fs.readFile(file, "utf8"));
const results = payload?.results && typeof payload.results === "object" ? payload.results : {};

function sanitizeMessage(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "[link rimosso]")
    .replace(/\b[A-Z0-9._-]{8,}\b/gi, "[codice rimosso]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

for (const [key, result] of Object.entries(results)) {
  results[key] = {
    state: String(result?.state || "unknown"),
    label: String(result?.label || "Stato non determinato").slice(0, 80),
    message: sanitizeMessage(result?.message) || "Nessun dettaglio disponibile.",
    checkedAt: result?.checkedAt || null,
    carrier: result?.carrier || null
  };
}

await fs.writeFile(file, `${JSON.stringify({
  version: 1,
  updatedAt: payload?.updatedAt || new Date().toISOString(),
  results
}, null, 2)}\n`);
