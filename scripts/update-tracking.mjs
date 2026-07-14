import fs from "node:fs/promises";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { chromium } from "playwright";

const DATA_FILE = "data/packages.enc.json";
const RESULTS_FILE = "data/tracking-results.json";
const PASSPHRASE = process.env.TRACKPACK_PASSPHRASE || "";
const SUPPORTED = new Set(["INPOST", "POSTE ITALIANE", "SDA", "BRT", "GLS"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

if (!PASSPHRASE) {
  throw new Error("Manca il secret TRACKPACK_PASSPHRASE.");
}

function normalizeCarrier(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function resultKey(carrier, code) {
  return createHash("sha256")
    .update(`${normalizeCarrier(carrier)}:${normalizeCode(code)}`)
    .digest("hex");
}

function bytesFromBase64(value) {
  return Uint8Array.from(Buffer.from(String(value || ""), "base64"));
}

function base64FromBytes(value) {
  return Buffer.from(value).toString("base64");
}

async function deriveKey(passphrase, salt, iterations = 210000) {
  const material = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function decryptPayload(payload) {
  if (!payload || ![1, 2].includes(payload.version)) {
    throw new Error("Formato archivio TrackPack non riconosciuto.");
  }
  const salt = bytesFromBase64(payload.salt);
  const iv = bytesFromBase64(payload.iv);
  const ciphertext = bytesFromBase64(payload.ciphertext);
  const key = await deriveKey(PASSPHRASE, salt, payload.iterations || 210000);
  const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const parsed = JSON.parse(decoder.decode(plaintext));
  if (Array.isArray(parsed)) return { packages: parsed, updatedAt: payload.updatedAt };
  if (!parsed || !Array.isArray(parsed.packages)) throw new Error("Archivio TrackPack non valido.");
  return parsed;
}

async function encryptPayload(packages, updatedAt) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(PASSPHRASE, salt, 210000);
  const plaintext = encoder.encode(JSON.stringify({ packages, updatedAt }));
  const ciphertext = new Uint8Array(
    await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  );
  return {
    version: 2,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 210000,
    salt: base64FromBytes(salt),
    iv: base64FromBytes(iv),
    ciphertext: base64FromBytes(ciphertext),
    updatedAt
  };
}

function officialUrls(carrier, code) {
  const safe = encodeURIComponent(code);
  switch (carrier) {
    case "INPOST":
      return [{ url: "https://inpost.it/trova-il-tuo-pacco", fill: true }];
    case "POSTE ITALIANE":
    case "SDA":
      return [{ url: `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${safe}`, fill: false }];
    case "BRT":
      return [
        { url: `https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numspe_par.htm&Nspedizione=${safe}`, fill: false },
        { url: `https://vas.brt.it/vas/sped_numspe_par.htm?lang=it&spediz=${safe}`, fill: true }
      ];
    case "GLS":
      return [
        { url: `https://www.gls-italy.com/it/servizi-online/ricerca-spedizioni?match=${safe}`, fill: false },
        { url: "https://www.gls-italy.com/it/servizi-per-destinatari/ricerca-spedizione", fill: true }
      ];
    default:
      return [];
  }
}

async function acceptCookies(page) {
  const labels = /accetta|accetto|consenti tutto|accetta tutti|accept all|continua senza accettare/i;
  const buttons = page.getByRole("button", { name: labels });
  for (let index = 0; index < Math.min(await buttons.count(), 4); index += 1) {
    try {
      const button = buttons.nth(index);
      if (await button.isVisible()) {
        await button.click({ timeout: 2500 });
        return;
      }
    } catch {}
  }
}

async function selectCodeType(page, code) {
  const selects = page.locator("select:visible");
  for (let i = 0; i < await selects.count(); i += 1) {
    const select = selects.nth(i);
    try {
      const options = await select.locator("option").evaluateAll((nodes) => nodes.map((node) => ({
        value: node.value,
        text: (node.textContent || "").trim()
      })));
      const wanted = /^\d{11}$/.test(code) ? /internazionale/i : /nazionale/i;
      const choice = options.find((option) => option.value && wanted.test(option.text))
        || options.find((option) => option.value && !/seleziona|scegli/i.test(option.text));
      if (choice) await select.selectOption(choice.value);
    } catch {}
  }
}

async function fillTrackingForm(page, code) {
  await selectCodeType(page, code);
  const inputs = page.locator('input:visible:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="password"]):not([type="submit"])');
  let best = null;
  let bestScore = -1;

  for (let i = 0; i < await inputs.count(); i += 1) {
    const input = inputs.nth(i);
    try {
      const attrs = await input.evaluate((node) => [
        node.name,
        node.id,
        node.placeholder,
        node.getAttribute("aria-label"),
        node.getAttribute("autocomplete")
      ].filter(Boolean).join(" ").toLowerCase());
      let score = 0;
      if (/tracking|sped|pacco|codice|numero|parcel|lettera|vettura|riferimento|collo/.test(attrs)) score += 10;
      if (/search|cerca/.test(attrs)) score += 4;
      if ((await input.getAttribute("type")) === "search") score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = input;
      }
    } catch {}
  }

  if (!best) return false;
  await best.fill(code);

  const submit = page.getByRole("button", { name: /cerca|invia|trova|track|ricerca|controlla/i }).first();
  try {
    if (await submit.isVisible()) await submit.click({ timeout: 5000 });
    else await best.press("Enter");
  } catch {
    await best.press("Enter").catch(() => {});
  }
  return true;
}

function cleanLines(text) {
  const ignored = /cookie|privacy|newsletter|menu|accedi|registrati|facebook|instagram|linkedin|copyright/i;
  const seen = new Set();
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 220)
    .filter((line) => !ignored.test(line))
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function detectResult(text, checkedAt) {
  const lines = cleanLines(text);
  const blocked = lines.find((line) => /captcha|access denied|forbidden|verifica di essere umano|non sei un robot|temporaneamente non disponibile/i.test(line));
  if (blocked) return { state: "unknown", label: "Controllo non disponibile", message: blocked, checkedAt };

  const notFound = lines.find((line) => /nessuna spedizione|spedizione non trovata|codice non valido|non (?:è stato|e stato) trovato|non risulta|nessun risultato/i.test(line));
  if (notFound) return { state: "unknown", label: "Non ancora rilevato", message: notFound, checkedAt };

  const delivered = lines.find((line) => {
    if (/non consegn|mancata consegna|tentata consegna|in consegna|da consegnare|consegna prevista|prevista consegna/i.test(line)) return false;
    return /^(?:stato(?: della spedizione)?\s*:?\s*)?(?:consegnat[oa]|delivered)\b/i.test(line)
      || /\bspedizione consegnata\b|\bconsegnat[oa] al destinatario\b|\britirat[oa] dal destinatario\b/i.test(line);
  });
  if (delivered) return { state: "delivered", label: "Consegnato", message: delivered, checkedAt };

  const exception = lines.find((line) => /mancata consegna|destinatario assente|in giacenza|anomalia|indirizzo errato|reso al mittente|problema nella consegna/i.test(line));
  if (exception) return { state: "exception", label: "Attenzione richiesta", message: exception, checkedAt };

  const outForDelivery = lines.find((line) => /\bin consegna\b|in fase di consegna|affidat[oa] al corriere per la consegna|out for delivery/i.test(line));
  if (outForDelivery) return { state: "out_for_delivery", label: "In consegna", message: outForDelivery, checkedAt };

  const inTransit = lines.find((line) => /\bin transito\b|\bin lavorazione\b|\bin trasferimento\b|presa in carico|ritirat[oa] dal mittente|accettat[oa] dal corriere|partit[oa] dal|arrivat[oa] (?:al|presso)|spedizione in viaggio/i.test(line));
  if (inTransit) return { state: "in_transit", label: "In transito", message: inTransit, checkedAt };

  const created = lines.find((line) => /spedizione creata|etichetta creata|dati della spedizione|informazioni ricevute|preavviso di spedizione/i.test(line));
  if (created) return { state: "label_created", label: "Spedizione registrata", message: created, checkedAt };

  const informative = lines.find((line) => /spedizione|pacco|tracking|consegna|transito/i.test(line));
  return {
    state: "unknown",
    label: "Stato non determinato",
    message: informative || "La pagina ufficiale non ha restituito uno stato leggibile.",
    checkedAt
  };
}

async function inspectOfficialPage(context, carrier, code) {
  const checkedAt = new Date().toISOString();
  let lastError = null;

  for (const candidate of officialUrls(carrier, code)) {
    const page = await context.newPage();
    try {
      await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await acceptCookies(page);
      if (candidate.fill) await fillTrackingForm(page, code);
      await page.waitForTimeout(4500);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const text = await page.locator("body").innerText({ timeout: 10000 });
      const result = detectResult(text, checkedAt);
      result.sourceUrl = page.url();
      result.carrier = carrier;
      if (result.state !== "unknown" || candidate === officialUrls(carrier, code).at(-1)) return result;
    } catch (error) {
      lastError = error;
    } finally {
      await page.close().catch(() => {});
    }
  }

  return {
    state: "unknown",
    label: "Controllo non riuscito",
    message: lastError?.message?.slice(0, 180) || "Il sito ufficiale non ha risposto.",
    checkedAt,
    carrier,
    sourceUrl: officialUrls(carrier, code)[0]?.url || ""
  };
}

const encryptedPayload = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
const decrypted = await decryptPayload(encryptedPayload);
const packages = Array.isArray(decrypted.packages) ? decrypted.packages : [];
const previousResults = await fs.readFile(RESULTS_FILE, "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => ({ version: 1, results: {} }));
const results = { ...(previousResults.results || {}) };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "it-IT",
  timezoneId: "Europe/Rome",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 TrackPack/1.0"
});

try {
  for (const pkg of packages) {
    const carrier = normalizeCarrier(pkg.carrier);
    const code = normalizeCode(pkg.trackingCode);
    if (!SUPPORTED.has(carrier) || !code || pkg.isArchived === true || pkg.status === "delivered") continue;

    console.log(`Controllo ${carrier} ${code.slice(0, 4)}…${code.slice(-4)}`);
    const result = await inspectOfficialPage(context, carrier, code);
    const key = resultKey(carrier, code);
    results[key] = result;

    const now = new Date().toISOString();
    pkg.trackingCheckedAt = result.checkedAt;
    pkg.trackingState = result.state;
    pkg.trackingMessage = result.message;
    pkg.trackingSourceUrl = result.sourceUrl;
    pkg.updatedAt = now;

    if (result.state === "delivered") {
      pkg.status = "delivered";
      pkg.deliveredAt = result.checkedAt;
      pkg.isArchived = true;
    }
  }
} finally {
  await context.close();
  await browser.close();
}

const updatedAt = new Date().toISOString();
const nextPayload = await encryptPayload(packages, updatedAt);
await fs.writeFile(DATA_FILE, `${JSON.stringify(nextPayload, null, 2)}\n`);
await fs.writeFile(RESULTS_FILE, `${JSON.stringify({ version: 1, updatedAt, results }, null, 2)}\n`);
console.log(`Aggiornamento completato: ${updatedAt}`);
