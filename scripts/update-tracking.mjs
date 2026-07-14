import fs from "node:fs/promises";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { chromium } from "playwright";

const DATA_FILE = "data/packages.enc.json";
const RESULTS_FILE = "data/tracking-results.json";
const PASSPHRASE = process.env.TRACKPACK_PASSPHRASE || "";
const SUPPORTED = new Set(["INPOST", "POSTE ITALIANE", "SDA", "BRT", "GLS"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

if (!PASSPHRASE) throw new Error("Manca il secret TRACKPACK_PASSPHRASE.");

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
  for (const frame of page.frames()) {
    const buttons = frame.getByRole("button", { name: labels });
    for (let index = 0; index < Math.min(await buttons.count().catch(() => 0), 5); index += 1) {
      try {
        const button = buttons.nth(index);
        if (await button.isVisible()) {
          await button.click({ timeout: 2500 });
          return;
        }
      } catch {}
    }
  }
}

async function selectCodeType(page, code) {
  for (const frame of page.frames()) {
    const selects = frame.locator("select:visible");
    for (let i = 0; i < await selects.count().catch(() => 0); i += 1) {
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
}

function inputScore(meta, code, buttonBox = null) {
  const attrs = `${meta.name} ${meta.id} ${meta.placeholder} ${meta.ariaLabel} ${meta.className}`.toLowerCase();
  let score = 0;
  if (/tracking|sped|pacco|codice|numero|parcel|lettera|vettura|riferimento|collo/.test(attrs)) score += 40;
  if (/search|cerca|trova/.test(attrs)) score += 10;
  if (meta.type === "search") score += 5;
  if (/newsletter|email|mail|telefono|phone|nome|surname|search-site|site-search/.test(attrs)) score -= 50;
  if (meta.maxLength && meta.maxLength >= code.length) score += 4;
  if (buttonBox && meta.box) {
    const vertical = buttonBox.y - (meta.box.y + meta.box.height);
    const horizontal = Math.abs((buttonBox.x + buttonBox.width / 2) - (meta.box.x + meta.box.width / 2));
    if (vertical >= -30 && vertical <= 500) score += Math.max(0, 30 - vertical / 20);
    if (horizontal <= 300) score += Math.max(0, 12 - horizontal / 30);
  }
  return score;
}

async function findTrackingControls(frame, code) {
  const buttons = frame.getByRole("button", { name: /^(?:trova|cerca|traccia|track|controlla)(?: il pacco)?$/i });
  let best = null;

  for (let b = 0; b < await buttons.count().catch(() => 0); b += 1) {
    const button = buttons.nth(b);
    try {
      if (!await button.isVisible()) continue;
      const buttonBox = await button.boundingBox();
      const form = button.locator("xpath=ancestor::form[1]");
      const container = await form.count() ? form : button.locator("xpath=ancestor::*[self::section or self::div][1]");
      const localInputs = container.locator('input:visible:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="password"]):not([type="submit"]):not([type="email"])');
      for (let i = 0; i < await localInputs.count().catch(() => 0); i += 1) {
        const input = localInputs.nth(i);
        const meta = await input.evaluate((node) => ({
          name: node.name || "",
          id: node.id || "",
          placeholder: node.placeholder || "",
          ariaLabel: node.getAttribute("aria-label") || "",
          className: node.className || "",
          type: node.type || "",
          maxLength: node.maxLength > 0 ? node.maxLength : 0
        }));
        meta.box = await input.boundingBox();
        const score = inputScore(meta, code, buttonBox) + 60;
        if (!best || score > best.score) best = { input, button, score };
      }
    } catch {}
  }

  const allInputs = frame.locator('input:visible:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="password"]):not([type="submit"]):not([type="email"])');
  for (let i = 0; i < await allInputs.count().catch(() => 0); i += 1) {
    const input = allInputs.nth(i);
    try {
      const meta = await input.evaluate((node) => ({
        name: node.name || "",
        id: node.id || "",
        placeholder: node.placeholder || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        className: node.className || "",
        type: node.type || "",
        maxLength: node.maxLength > 0 ? node.maxLength : 0
      }));
      meta.box = await input.boundingBox();
      const score = inputScore(meta, code);
      if (!best || score > best.score) best = { input, button: null, score };
    } catch {}
  }

  return best && best.score > 0 ? best : null;
}

async function fillTrackingForm(page, code, carrier) {
  await selectCodeType(page, code);

  for (const frame of page.frames()) {
    const controls = await findTrackingControls(frame, code);
    if (!controls) continue;

    try {
      await controls.input.scrollIntoViewIfNeeded();
      await controls.input.click({ timeout: 5000 });
      await controls.input.fill("");
      await controls.input.type(code, { delay: 25 });
      await controls.input.evaluate((node) => {
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      });

      if (controls.button) {
        await controls.button.click({ timeout: 7000 });
      } else {
        await controls.input.press("Enter");
      }
      console.log(`${carrier}: form tracking compilato nel frame ${frame.url().split("?")[0]}`);
      return true;
    } catch (error) {
      console.log(`${carrier}: tentativo form non riuscito (${error?.name || "errore"})`);
    }
  }
  return false;
}

function cleanLines(text) {
  const ignored = /cookie|privacy|newsletter|menu|accedi|registrati|facebook|instagram|linkedin|copyright/i;
  const seen = new Set();
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 240)
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

  const notFound = lines.find((line) => /nessuna spedizione|spedizione non trovata|codice non valido|non (?:è stato|e stato) trovato|non risulta|nessun risultato|tracking non trovato/i.test(line));
  if (notFound) return { state: "unknown", label: "Non ancora rilevato", message: notFound, checkedAt };

  const delivered = lines.find((line) => {
    if (/non consegn|mancata consegna|tentata consegna|in consegna|da consegnare|consegna prevista|prevista consegna/i.test(line)) return false;
    return /^(?:stato(?: della spedizione)?\s*:?\s*)?(?:consegnat[oa]|delivered)\b/i.test(line)
      || /\bspedizione consegnata\b|\bconsegnat[oa] al destinatario\b|\britirat[oa] dal destinatario\b/i.test(line);
  });
  if (delivered) return { state: "delivered", label: "Consegnato", message: delivered, checkedAt };

  const exception = lines.find((line) => /mancata consegna|destinatario assente|in giacenza|anomalia|indirizzo errato|reso al mittente|problema nella consegna|danneggiat/i.test(line));
  if (exception) return { state: "exception", label: "Attenzione richiesta", message: exception, checkedAt };

  const outForDelivery = lines.find((line) => /\bin consegna\b|in fase di consegna|affidat[oa] al corriere per la consegna|out for delivery/i.test(line));
  if (outForDelivery) return { state: "out_for_delivery", label: "In consegna", message: outForDelivery, checkedAt };

  const inTransit = lines.find((line) => /\bin transito\b|\bin lavorazione\b|\bin trasferimento\b|presa in carico|ritirat[oa] dal mittente|accettat[oa] dal corriere|partit[oa] dal|arrivat[oa] (?:al|presso)|spedizione in viaggio|sorting|hub/i.test(line));
  if (inTransit) return { state: "in_transit", label: "In transito", message: inTransit, checkedAt };

  const created = lines.find((line) => /spedizione creata|etichetta creata|dati della spedizione|informazioni ricevute|preavviso di spedizione|label created/i.test(line));
  if (created) return { state: "label_created", label: "Spedizione registrata", message: created, checkedAt };

  const informative = lines.find((line) => /spedizione|pacco|tracking|consegna|transito|locker|point/i.test(line));
  return {
    state: "unknown",
    label: "Stato non determinato",
    message: informative || "La pagina ufficiale non ha restituito uno stato leggibile.",
    checkedAt
  };
}

function walkJson(value, path = "", output = []) {
  if (value === null || value === undefined || output.length > 500) return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, `${path}[${index}]`, output));
    return output;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (["status", "state", "description", "message", "event", "eventDescription", "label", "details", "history", "tracking_details", "events"].some((needle) => key.toLowerCase().includes(needle.toLowerCase()))) {
        if (typeof item === "string" || typeof item === "number") output.push(`${nextPath}: ${item}`);
      }
      walkJson(item, nextPath, output);
    }
  }
  return output;
}

function resultFromJson(value, checkedAt) {
  const lines = walkJson(value).slice(0, 250);
  if (!lines.length) return null;
  const detected = detectResult(lines.join("\n"), checkedAt);
  return detected.state !== "unknown" ? detected : null;
}

function safeNetworkUrl(url, code) {
  return String(url || "").replaceAll(code, "[tracking]").split("#")[0].slice(0, 240);
}

async function inspectInpostPage(context, code) {
  const checkedAt = new Date().toISOString();
  const page = await context.newPage();
  const networkResults = [];
  const networkLog = [];

  page.on("response", async (response) => {
    const url = response.url();
    const contentType = String(response.headers()["content-type"] || "");
    const interesting = /track|parcel|shipment|sped|pacco|consignment|delivery|event/i.test(url);
    if (!interesting && !contentType.includes("json")) return;
    try {
      const body = contentType.includes("json") ? await response.json() : null;
      if (body) {
        const result = resultFromJson(body, checkedAt);
        if (result) networkResults.push(result);
        networkLog.push(`${response.status()} ${safeNetworkUrl(url, code)} keys=${Object.keys(body || {}).slice(0, 12).join(",")}`);
      }
    } catch {}
  });

  try {
    await page.goto("https://inpost.it/trova-il-tuo-pacco", { waitUntil: "domcontentloaded", timeout: 50000 });
    await acceptCookies(page);
    await page.waitForTimeout(1800);

    const submitted = await fillTrackingForm(page, code, "INPOST");
    if (!submitted) console.log("INPOST: nessun campo tracking affidabile trovato");

    await page.waitForTimeout(7000);
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

    for (const line of networkLog.slice(-12)) console.log(`INPOST rete: ${line}`);
    if (networkResults.length) {
      const result = networkResults.at(-1);
      result.sourceUrl = page.url();
      result.carrier = "INPOST";
      return result;
    }

    const frameTexts = [];
    for (const frame of page.frames()) {
      try {
        const text = await frame.locator("body").innerText({ timeout: 8000 });
        if (text) frameTexts.push(text);
      } catch {}
    }
    const result = detectResult(frameTexts.join("\n"), checkedAt);
    result.sourceUrl = page.url();
    result.carrier = "INPOST";

    if (result.state === "unknown" && !submitted) {
      result.label = "Form InPost non rilevato";
      result.message = "La pagina InPost non ha esposto un campo tracking utilizzabile dall’automazione.";
    }
    return result;
  } catch (error) {
    return {
      state: "unknown",
      label: "Controllo InPost non riuscito",
      message: error?.name === "TimeoutError"
        ? "Il sito InPost non ha completato il caricamento entro il tempo previsto."
        : "Il sito InPost non ha risposto correttamente.",
      checkedAt,
      carrier: "INPOST",
      sourceUrl: "https://inpost.it/trova-il-tuo-pacco"
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function inspectOfficialPage(context, carrier, code) {
  if (carrier === "INPOST") return inspectInpostPage(context, code);

  const checkedAt = new Date().toISOString();
  let lastError = null;
  const candidates = officialUrls(carrier, code);

  for (const candidate of candidates) {
    const page = await context.newPage();
    try {
      await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await acceptCookies(page);
      if (candidate.fill) await fillTrackingForm(page, code, carrier);
      await page.waitForTimeout(4500);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const texts = [];
      for (const frame of page.frames()) {
        try {
          const text = await frame.locator("body").innerText({ timeout: 5000 });
          if (text) texts.push(text);
        } catch {}
      }
      const result = detectResult(texts.join("\n"), checkedAt);
      result.sourceUrl = page.url();
      result.carrier = carrier;
      if (result.state !== "unknown" || candidate === candidates.at(-1)) return result;
    } catch (error) {
      lastError = error;
    } finally {
      await page.close().catch(() => {});
    }
  }

  return {
    state: "unknown",
    label: "Controllo non riuscito",
    message: lastError?.name === "TimeoutError"
      ? "Il sito del corriere non ha completato il caricamento."
      : "Il sito del corriere non ha risposto correttamente.",
    checkedAt,
    carrier,
    sourceUrl: candidates[0]?.url || ""
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
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 1100 },
  extraHTTPHeaders: {
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.7"
  }
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
