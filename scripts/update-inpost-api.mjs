import fs from "node:fs/promises";
import { createHash, randomBytes, webcrypto } from "node:crypto";

const DATA_FILE = "data/packages.enc.json";
const RESULTS_FILE = "data/tracking-results.json";
const PASSPHRASE = process.env.TRACKPACK_PASSPHRASE || "";
const API_BASE = "https://api-shipx-it.easypack24.net/v1/tracking/";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

if (!PASSPHRASE) throw new Error("Manca il secret TRACKPACK_PASSPHRASE.");

const STATUS = {
  created: ["label_created", "Spedizione registrata"],
  confirmed: ["label_created", "Spedizione confermata"],
  offers_prepared: ["label_created", "Spedizione preparata"],
  adopted_at_source_branch: ["in_transit", "Presa in carico"],
  sent_from_source_branch: ["in_transit", "Partita dalla filiale di origine"],
  adopted_at_sorting_center: ["in_transit", "Al centro di smistamento"],
  sent_from_sorting_center: ["in_transit", "Partita dal centro di smistamento"],
  adopted_at_destination_branch: ["in_transit", "Alla filiale di destinazione"],
  out_for_delivery: ["out_for_delivery", "In consegna"],
  ready_to_pickup: ["out_for_delivery", "Pronto per il ritiro"],
  delivered: ["delivered", "Consegnato"],
  avizo: ["exception", "Tentativo di consegna"],
  pickup_reminder_sent: ["out_for_delivery", "Promemoria di ritiro inviato"],
  returned_to_sender: ["exception", "Restituito al mittente"],
  returned_to_sender_accepted: ["exception", "Reso preso in carico"],
  canceled: ["exception", "Spedizione annullata"],
  claim: ["exception", "Segnalazione aperta"],
  missing: ["exception", "Spedizione non localizzata"],
  damaged: ["exception", "Spedizione danneggiata"]
};

function normalizeCode(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function resultKey(code) {
  return createHash("sha256").update(`INPOST:${normalizeCode(code)}`).digest("hex");
}

function bytesFromBase64(value) {
  return Uint8Array.from(Buffer.from(String(value || ""), "base64"));
}

function base64FromBytes(value) {
  return Buffer.from(value).toString("base64");
}

async function deriveKey(passphrase, salt, iterations = 210000) {
  const material = await webcrypto.subtle.importKey(
    "raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]
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
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
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

function formatEventDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome"
  }).format(date);
}

function normalizeResponse(data, checkedAt) {
  const details = Array.isArray(data?.tracking_details) ? [...data.tracking_details] : [];
  details.sort((a, b) => Date.parse(b?.datetime || "") - Date.parse(a?.datetime || ""));
  const latest = details[0];
  const statusKey = String(latest?.status || latest?.origin_status || data?.status || "").toLowerCase();
  const mapped = STATUS[statusKey] || STATUS[String(data?.status || "").toLowerCase()];
  if (!mapped) {
    return {
      state: "unknown",
      label: "Stato InPost non riconosciuto",
      message: statusKey ? `Stato ricevuto: ${statusKey.replaceAll("_", " ")}` : "InPost non ha restituito uno stato.",
      checkedAt,
      carrier: "INPOST"
    };
  }
  const [state, label] = mapped;
  const when = formatEventDate(latest?.datetime || data?.updated_at || data?.created_at);
  return {
    state,
    label,
    message: when ? `${label} · ${when}` : label,
    checkedAt,
    carrier: "INPOST"
  };
}

async function fetchTracking(code) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(`${API_BASE}${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json", "User-Agent": "TrackPack/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    console.log(`INPOST Italia ${code.slice(0, 4)}…${code.slice(-4)}: HTTP ${response.status}`);
    if (response.status === 404) {
      return {
        state: "unknown",
        label: "Non ancora rilevato",
        message: "Il codice non risulta ancora nell’API InPost Italia.",
        checkedAt,
        carrier: "INPOST"
      };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return normalizeResponse(await response.json(), checkedAt);
  } catch (error) {
    return {
      state: "unknown",
      label: "API InPost non disponibile",
      message: error?.name === "TimeoutError" ? "InPost non ha risposto entro 15 secondi." : "La richiesta all’API InPost Italia non è riuscita.",
      checkedAt,
      carrier: "INPOST"
    };
  }
}

const encrypted = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
const decrypted = await decryptPayload(encrypted);
const packages = decrypted.packages || [];
const resultsPayload = await fs.readFile(RESULTS_FILE, "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => ({ version: 1, results: {} }));
const results = { ...(resultsPayload.results || {}) };
let checkedAny = false;

for (const pkg of packages) {
  const carrier = String(pkg?.carrier || "").trim().toUpperCase();
  const code = normalizeCode(pkg?.trackingCode);
  if (carrier !== "INPOST" || !code || pkg.isArchived === true || pkg.status === "delivered") continue;
  checkedAny = true;
  const result = await fetchTracking(code);
  results[resultKey(code)] = result;
  pkg.trackingCheckedAt = result.checkedAt;
  pkg.trackingState = result.state;
  pkg.trackingMessage = result.message;
  pkg.trackingSourceUrl = "https://inpost.it/trova-il-tuo-pacco";
  pkg.updatedAt = new Date().toISOString();
  if (result.state === "delivered") {
    pkg.status = "delivered";
    pkg.deliveredAt = result.checkedAt;
    pkg.isArchived = true;
  }
}

if (checkedAny) {
  const updatedAt = new Date().toISOString();
  await fs.writeFile(DATA_FILE, `${JSON.stringify(await encryptPayload(packages, updatedAt), null, 2)}\n`);
  await fs.writeFile(RESULTS_FILE, `${JSON.stringify({ version: 1, updatedAt, results }, null, 2)}\n`);
  console.log(`Aggiornamento API InPost completato: ${updatedAt}`);
} else {
  console.log("Nessun pacco InPost attivo da controllare.");
}
