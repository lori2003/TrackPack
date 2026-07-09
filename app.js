(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const LOCAL_UPDATED_KEY = "trackpack.local.updatedAt";
  const LAST_SYNC_KEY = "trackpack.github.lastSync";
  const TOKEN_KEY = "trackpack.github.token";
  const PASS_KEY = "trackpack.github.passphrase";
  const SEED_CODE = "827049017600018049468336";
  const REPO = "lori2003/TrackPack";
  const BRANCH = "main";
  const DATA_PATH = "data/packages.enc.json";
  const GITHUB_API = `https://api.github.com/repos/${REPO}`;
  const INPOST_API = "https://api-shipx-pl.easypack24.net/v1/tracking/";
  const CARRIERS = ["Amazon", "BRT", "DHL", "DPD", "FedEx", "GLS", "INPOST", "Poste Italiane", "SDA", "UPS", "Altro"];
  const STATUS_LABELS = { pending: "In attesa", delivered: "Consegnato" };

  const state = {
    packages: [],
    view: "active",
    filter: "all",
    search: "",
    sort: "dateDesc",
    selectedId: null,
    storageOk: true,
    syncing: false,
    syncQueued: false,
    syncTimer: null,
    toastTimer: null
  };

  const el = (id) => document.getElementById(id);

  function uuid() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cleanText(value, max = 255) {
    const text = String(value ?? "").trim().slice(0, max);
    return text || undefined;
  }

  function normalizeStatus(value) {
    return String(value).toLowerCase() === "delivered" ? "delivered" : "pending";
  }

  function safeDate(value, fallback = new Date().toISOString()) {
    return value && !Number.isNaN(Date.parse(value)) ? value : fallback;
  }

  function normalizePackage(value) {
    if (!value || typeof value !== "object") return null;
    const trackingCode = cleanText(value.trackingCode, 100);
    const carrier = cleanText(value.carrier, 100);
    if (!trackingCode || !carrier) return null;
    const createdAt = safeDate(value.createdAt);
    const status = normalizeStatus(value.status);
    return {
      id: cleanText(value.id, 100) || uuid(),
      trackingCode,
      carrier,
      description: cleanText(value.description),
      status,
      origin: cleanText(value.origin),
      destination: cleanText(value.destination),
      estimatedDelivery: value.estimatedDelivery && !Number.isNaN(Date.parse(value.estimatedDelivery)) ? value.estimatedDelivery : undefined,
      deliveredAt: status === "delivered" && value.deliveredAt && !Number.isNaN(Date.parse(value.deliveredAt)) ? value.deliveredAt : undefined,
      isArchived: value.isArchived === true || value.isArchived === "true",
      createdAt,
      updatedAt: safeDate(value.updatedAt, createdAt)
    };
  }

  function seedPackage() {
    const stamp = new Date().toISOString();
    return {
      id: "inpost-seed-827049017600018049468336",
      trackingCode: SEED_CODE,
      carrier: "INPOST",
      description: "Pacco INPOST",
      status: "pending",
      isArchived: false,
      createdAt: stamp,
      updatedAt: stamp
    };
  }

  function storageAvailable() {
    try {
      const key = "__trackpack_test__";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function loadPackages() {
    state.storageOk = storageAvailable();
    if (!state.storageOk) return [seedPackage()];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        const initial = [seedPackage()];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        localStorage.setItem(LOCAL_UPDATED_KEY, new Date().toISOString());
        return initial;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Archivio locale non valido");
      return parsed.map(normalizePackage).filter(Boolean);
    } catch (error) {
      console.error(error);
      return [seedPackage()];
    }
  }

  function persistPackages({ sync = true, render = true } = {}) {
    if (!storageAvailable()) {
      state.storageOk = false;
      updateStorageNotice();
      if (render) renderAll();
      return;
    }
    const stamp = new Date().toISOString();
    state.packages = state.packages.map((pkg) => normalizePackage(pkg)).filter(Boolean);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.packages));
      localStorage.setItem(LOCAL_UPDATED_KEY, stamp);
      state.storageOk = true;
    } catch (error) {
      console.error(error);
      state.storageOk = false;
    }
    updateStorageNotice();
    if (render) renderAll();
    if (sync) scheduleSync();
  }

  function updateStorageNotice() {
    el("storageWarning").classList.toggle("hidden", state.storageOk);
    const connected = Boolean(getToken() && getPassphrase());
    el("storageLabel").textContent = connected ? "Cifrati e sincronizzati con GitHub" : (state.storageOk ? "Salvati su questo dispositivo" : "Sessione temporanea");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'\"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;"
    })[char]);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("it-IT").format(date);
  }

  function formatDateTime(value) {
    if (!value) return "Data non disponibile";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data non disponibile";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function showToast(message) {
    const toast = el("toast");
    clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    state.toastTimer = setTimeout(() => toast.classList.add("hidden"), 2400);
  }

  function trackingUrl(pkg) {
    const code = encodeURIComponent(pkg.trackingCode);
    switch (pkg.carrier.toUpperCase()) {
      case "DHL": return `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${code}`;
      case "FEDEX": return `https://www.fedex.com/fedextrack/?trknbr=${code}`;
      case "UPS": return `https://www.ups.com/track?tracknum=${code}`;
      case "POSTE ITALIANE":
      case "SDA": return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${code}`;
      case "BRT": return "https://vas.brt.it/vas/sped_numspe_par.htm";
      case "GLS": return "https://www.gls-italy.com/it/servizi-per-destinatari/dettaglio-spedizione";
      case "DPD": return `https://tracking.dpd.de/status/it_IT/parcel/${code}`;
      case "AMAZON": return "https://www.amazon.it/gp/css/order-history";
      default: return "";
    }
  }

  function getVisiblePackages() {
    const query = state.search.toLowerCase();
    const visible = state.packages
      .filter((pkg) => state.view === "active" ? !pkg.isArchived : pkg.isArchived)
      .filter((pkg) => state.view === "archived" || state.filter === "all" || pkg.status === state.filter)
      .filter((pkg) => !query || pkg.trackingCode.toLowerCase().includes(query) || (pkg.description || "").toLowerCase().includes(query) || pkg.carrier.toLowerCase().includes(query));

    visible.sort((a, b) => {
      if (state.sort === "dateAsc") return new Date(a.createdAt) - new Date(b.createdAt);
      if (state.sort === "dateDesc") return new Date(b.createdAt) - new Date(a.createdAt);
      const aName = a.description || a.trackingCode;
      const bName = b.description || b.trackingCode;
      return state.sort === "nameAsc" ? aName.localeCompare(bName, "it") : bName.localeCompare(aName, "it");
    });
    return visible;
  }

  function renderFilters() {
    const active = state.packages.filter((pkg) => !pkg.isArchived);
    const counts = {
      all: active.length,
      pending: active.filter((pkg) => pkg.status === "pending").length,
      delivered: active.filter((pkg) => pkg.status === "delivered").length
    };
    el("activeCount").textContent = String(counts.all);
    el("statusFilters").classList.toggle("hidden", state.view === "archived");
    const filters = [
      ["all", "Tutti"],
      ["pending", "In attesa"],
      ["delivered", "Consegnato"]
    ];
    el("statusFilters").innerHTML = filters.map(([key, label]) => {
      const count = counts[key] ? ` (${counts[key]})` : "";
      return `<button class="filter ${state.filter === key ? "active" : ""}" data-filter="${key}">${label}${count}</button>`;
    }).join("");
  }

  function renderPackages() {
    renderFilters();
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.view === state.view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    const list = el("packageList");
    const packages = getVisiblePackages();
    if (!packages.length) {
      const node = el("emptyTemplate").content.cloneNode(true);
      node.querySelector("p").textContent = state.view === "active" ? "Aggiungi il tuo primo pacco per iniziare." : "Non hai pacchi archiviati.";
      list.replaceChildren(node);
      return;
    }

    list.innerHTML = packages.map((pkg) => {
      const route = pkg.origin || pkg.destination
        ? `<div class="meta-row"><span>⌖</span><span>${escapeHtml(pkg.origin || "?")} → ${escapeHtml(pkg.destination || "?")}</span></div>`
        : "";
      const delivered = formatDate(pkg.deliveredAt);
      const estimate = formatDate(pkg.estimatedDelivery);
      const dateRow = delivered || estimate
        ? `<div class="meta-row"><span>◷</span><span>${delivered ? `Consegnato il ${delivered}` : `Stima: ${estimate}`}</span></div>`
        : "";
      const externalUrl = trackingUrl(pkg);
      const trackingAction = pkg.carrier.toUpperCase() === "INPOST"
        ? `<button class="button primary" data-action="track-inpost">⌁ Controlla tracking</button>`
        : (externalUrl ? `<a class="button primary" href="${externalUrl}" target="_blank" rel="noopener noreferrer">↗ Apri tracking</a>` : "");

      return `<article class="package-card ${pkg.status}" data-id="${escapeHtml(pkg.id)}">
        <div class="progress-track"><div class="progress-bar" style="width:${pkg.status === "delivered" ? 100 : 25}%"></div></div>
        <div class="card-inner">
          <div class="card-head">
            <div class="card-title-wrap">
              <span class="badge ${pkg.status}">${STATUS_LABELS[pkg.status]}</span>
              <h2 class="package-title">${escapeHtml(pkg.description || pkg.trackingCode)}</h2>
            </div>
            <details class="card-menu">
              <summary aria-label="Azioni">⋮</summary>
              <div class="menu-pop">
                <button data-action="rename">Rinomina</button>
                <button data-action="status">Cambia stato</button>
                <button data-action="archive">${pkg.isArchived ? "Ripristina" : "Archivia"}</button>
                <button class="delete-action" data-action="delete">Elimina</button>
              </div>
            </details>
          </div>
          <div class="meta">
            <div class="meta-row"><span>▣</span><span class="mono">${escapeHtml(pkg.trackingCode)}</span><span>· ${escapeHtml(pkg.carrier)}</span></div>
            ${route}${dateRow}
          </div>
          <div class="card-actions">
            <button class="button secondary" data-action="copy">⧉ Copia codice</button>
            ${trackingAction}
          </div>
        </div>
      </article>`;
    }).join("");
  }

  function renderAll() {
    renderPackages();
    updateStorageNotice();
  }

  function closeAllMenus(except = null) {
    document.querySelectorAll("details.card-menu[open]").forEach((menu) => {
      if (menu !== except) menu.removeAttribute("open");
    });
  }

  function closeDialog(id) {
    const dialog = el(id);
    if (dialog?.open) dialog.close();
  }

  function updatePackage(id, updates) {
    const stamp = new Date().toISOString();
    state.packages = state.packages.map((pkg) => pkg.id === id ? normalizePackage({ ...pkg, ...updates, id: pkg.id, updatedAt: stamp }) : pkg).filter(Boolean);
    persistPackages();
  }

  function resetAddForm() {
    el("addForm").reset();
    el("carrier").value = "";
    el("formError").classList.add("hidden");
    document.querySelectorAll(".carrier-option").forEach((button) => button.classList.remove("selected"));
  }

  function selectCarrier(carrier) {
    el("carrier").value = carrier;
    document.querySelectorAll(".carrier-option").forEach((button) => button.classList.toggle("selected", button.dataset.carrier === carrier));
  }

  const INPOST_STATUS_LABELS = {
    created: "Spedizione creata",
    confirmed: "Spedizione confermata",
    offers_prepared: "Spedizione preparata",
    adopted_at_source_branch: "Presa in carico dalla filiale di partenza",
    sent_from_source_branch: "Partita dalla filiale di partenza",
    adopted_at_sorting_center: "Arrivata al centro di smistamento",
    sent_from_sorting_center: "Partita dal centro di smistamento",
    adopted_at_destination_branch: "Arrivata alla filiale di destinazione",
    out_for_delivery: "In consegna",
    ready_to_pickup: "Pronta per il ritiro",
    delivered: "Consegnata",
    avizo: "Tentativo di consegna effettuato",
    pickup_reminder_sent: "Promemoria di ritiro inviato",
    returned_to_sender: "Restituita al mittente",
    returned_to_sender_accepted: "Reso preso in carico",
    canceled: "Spedizione annullata",
    claim: "Segnalazione aperta",
    missing: "Spedizione non localizzata",
    damaged: "Spedizione danneggiata"
  };

  function humanizeInpostStatus(value) {
    const key = String(value || "").toLowerCase();
    return INPOST_STATUS_LABELS[key] || (key ? key.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase()) : "Stato non disponibile");
  }

  async function fetchInpost(code, signal) {
    const response = await fetch(`${INPOST_API}${encodeURIComponent(code)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error("Spedizione non trovata");
      throw new Error(`Errore INPOST (${response.status})`);
    }
    return response.json();
  }

  function renderTrackingDetails(data) {
    const details = Array.isArray(data.tracking_details) ? [...data.tracking_details] : [];
    details.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    const machine = data.custom_attributes?.target_machine_detail;
    const hasPlace = machine?.name || machine?.address?.line1 || machine?.address?.line2;
    const place = hasPlace
      ? `<div class="live-place"><strong>Punto di ritiro o consegna</strong>${escapeHtml(machine?.name || "")}<br>${escapeHtml(machine?.address?.line1 || "")} ${escapeHtml(machine?.address?.line2 || "")}</div>`
      : "";
    const timeline = details.length
      ? `<div class="live-timeline">${details.map((item) => `<div class="live-event"><strong>${escapeHtml(humanizeInpostStatus(item.status || item.origin_status))}</strong><time>${escapeHtml(formatDateTime(item.datetime))}</time></div>`).join("")}</div>`
      : `<div class="live-error">INPOST non ha ancora pubblicato eventi dettagliati.</div>`;
    return `<div class="live-summary"><strong>${escapeHtml(humanizeInpostStatus(data.status))}</strong><span>Aggiornato: ${escapeHtml(formatDateTime(data.updated_at || data.created_at))}</span></div>${place}${timeline}`;
  }

  function deliveredEventDate(data) {
    const event = Array.isArray(data.tracking_details)
      ? data.tracking_details.find((item) => String(item.status || item.origin_status).toLowerCase() === "delivered")
      : null;
    return safeDate(event?.datetime, new Date().toISOString());
  }

  async function openInpostTracking(pkg) {
    const dialog = el("trackingDialog");
    el("trackingDialogCode").textContent = pkg.trackingCode;
    el("trackingContent").innerHTML = '<div class="live-loading">Controllo dello stato in corso…</div>';
    dialog.showModal();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const data = await fetchInpost(pkg.trackingCode, controller.signal);
      clearTimeout(timeout);
      el("trackingContent").innerHTML = renderTrackingDetails(data);
      const delivered = String(data.status || "").toLowerCase() === "delivered";
      if (delivered && pkg.status !== "delivered") {
        updatePackage(pkg.id, { status: "delivered", deliveredAt: deliveredEventDate(data) });
      }
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "INPOST sta impiegando troppo tempo a rispondere. Riprova tra poco."
        : error?.message === "Spedizione non trovata"
          ? "Il codice non risulta ancora nei sistemi INPOST."
          : "Non è stato possibile recuperare il tracking in questo momento.";
      el("trackingContent").innerHTML = `<div class="live-error">${escapeHtml(message)}</div>`;
    }
  }

  async function refreshInpostStatuses() {
    if (!navigator.onLine || document.hidden) return;
    const pending = state.packages.filter((pkg) => pkg.status === "pending" && pkg.carrier.toUpperCase() === "INPOST");
    for (const pkg of pending) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const data = await fetchInpost(pkg.trackingCode, controller.signal);
        clearTimeout(timeout);
        if (String(data.status || "").toLowerCase() === "delivered") {
          updatePackage(pkg.id, { status: "delivered", deliveredAt: deliveredEventDate(data) });
        }
      } catch {
        // Un errore temporaneo non deve bloccare l'app.
      }
    }
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
  }

  function getPassphrase() {
    return sessionStorage.getItem(PASS_KEY) || localStorage.getItem(PASS_KEY) || "";
  }

  function setCredentials(token, passphrase, remember) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(PASS_KEY, passphrase);
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(PASS_KEY, passphrase);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PASS_KEY);
    }
  }

  function clearCredentials() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PASS_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PASS_KEY);
  }

  function apiHeaders(token = getToken()) {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value).replace(/\s/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function utf8ToBase64(value) {
    return bytesToBase64(new TextEncoder().encode(value));
  }

  function base64ToUtf8(value) {
    return new TextDecoder().decode(base64ToBytes(value));
  }

  async function deriveKey(passphrase, salt) {
    if (!globalThis.crypto?.subtle) throw new Error("La cifratura non è supportata da questo browser.");
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptPackages(packages, passphrase, updatedAt) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify({ packages, updatedAt }));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    return {
      version: 2,
      algorithm: "AES-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: 210000,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      updatedAt
    };
  }

  async function decryptPayload(payload, passphrase) {
    if (!payload || ![1, 2].includes(payload.version)) throw new Error("Formato dati GitHub non riconosciuto.");
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const ciphertext = base64ToBytes(payload.ciphertext);
    const key = await deriveKey(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (Array.isArray(parsed)) {
      return { packages: parsed.map(normalizePackage).filter(Boolean), updatedAt: safeDate(payload.updatedAt) };
    }
    if (!parsed || !Array.isArray(parsed.packages)) throw new Error("Dati GitHub non validi.");
    return { packages: parsed.packages.map(normalizePackage).filter(Boolean), updatedAt: safeDate(parsed.updatedAt || payload.updatedAt) };
  }

  async function fetchRemoteFile(token = getToken()) {
    const response = await fetch(`${GITHUB_API}/contents/${DATA_PATH}?ref=${encodeURIComponent(BRANCH)}&t=${Date.now()}`, {
      headers: apiHeaders(token),
      cache: "no-store"
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ha risposto con errore ${response.status}.`);
    return response.json();
  }

  async function readRemote(token = getToken(), passphrase = getPassphrase()) {
    const file = await fetchRemoteFile(token);
    if (!file) return null;
    const payload = JSON.parse(base64ToUtf8(file.content));
    const decrypted = await decryptPayload(payload, passphrase);
    return { ...decrypted, sha: file.sha };
  }

  function mergePackages(localPackages, remotePackages) {
    const map = new Map();
    for (const pkg of [...remotePackages, ...localPackages]) {
      const key = pkg.id || `${pkg.carrier}:${pkg.trackingCode}`;
      const current = map.get(key);
      if (!current || new Date(pkg.updatedAt) >= new Date(current.updatedAt)) map.set(key, pkg);
    }
    return [...map.values()].map(normalizePackage).filter(Boolean);
  }

  function setSyncState(mode, text, message = "", isError = false) {
    const button = el("githubSyncFab");
    button.dataset.state = mode;
    button.textContent = `☁ ${text}`;
    if (message) showSyncMessage(message, isError);
    updateStorageNotice();
  }

  function showSyncMessage(message, isError = false) {
    const box = el("syncMessage");
    box.textContent = message;
    box.classList.remove("hidden");
    box.classList.toggle("error", isError);
  }

  async function pushRemote({ retry = true } = {}) {
    const token = getToken();
    const passphrase = getPassphrase();
    if (!token || !passphrase) return false;
    const updatedAt = localStorage.getItem(LOCAL_UPDATED_KEY) || new Date().toISOString();
    const payload = await encryptPackages(state.packages, passphrase, updatedAt);
    const current = await fetchRemoteFile(token);
    const body = {
      message: `Sync TrackPack ${updatedAt}`,
      content: utf8ToBase64(JSON.stringify(payload, null, 2)),
      branch: BRANCH
    };
    if (current?.sha) body.sha = current.sha;

    const response = await fetch(`${GITHUB_API}/contents/${DATA_PATH}`, {
      method: "PUT",
      headers: { ...apiHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (response.status === 409 && retry) return pushRemote({ retry: false });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.message || `Errore GitHub ${response.status}.`);
    }
    localStorage.setItem(LAST_SYNC_KEY, updatedAt);
    return true;
  }

  async function reconcileWithRemote({ forcePull = false } = {}) {
    if (state.syncing) {
      state.syncQueued = true;
      return;
    }
    const token = getToken();
    const passphrase = getPassphrase();
    if (!token || !passphrase || !navigator.onLine) return;

    state.syncing = true;
    setSyncState("syncing", "Sincronizzazione…");
    try {
      const remote = await readRemote(token, passphrase);
      const localUpdated = safeDate(localStorage.getItem(LOCAL_UPDATED_KEY), "1970-01-01T00:00:00.000Z");
      const lastSync = safeDate(localStorage.getItem(LAST_SYNC_KEY), "1970-01-01T00:00:00.000Z");

      if (!remote) {
        await pushRemote();
      } else if (forcePull) {
        state.packages = remote.packages;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.packages));
        localStorage.setItem(LOCAL_UPDATED_KEY, remote.updatedAt);
        localStorage.setItem(LAST_SYNC_KEY, remote.updatedAt);
        renderAll();
      } else {
        const remoteChanged = new Date(remote.updatedAt) > new Date(lastSync);
        const localChanged = new Date(localUpdated) > new Date(lastSync);

        if (remoteChanged && !localChanged) {
          state.packages = remote.packages;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.packages));
          localStorage.setItem(LOCAL_UPDATED_KEY, remote.updatedAt);
          localStorage.setItem(LAST_SYNC_KEY, remote.updatedAt);
          renderAll();
        } else if (localChanged && !remoteChanged) {
          await pushRemote();
        } else if (remoteChanged && localChanged) {
          state.packages = mergePackages(state.packages, remote.packages);
          const mergedAt = new Date().toISOString();
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.packages));
          localStorage.setItem(LOCAL_UPDATED_KEY, mergedAt);
          renderAll();
          await pushRemote();
        } else if (!localStorage.getItem(LAST_SYNC_KEY)) {
          state.packages = mergePackages(state.packages, remote.packages);
          const mergedAt = new Date().toISOString();
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.packages));
          localStorage.setItem(LOCAL_UPDATED_KEY, mergedAt);
          renderAll();
          await pushRemote();
        }
      }
      setSyncState("ok", "Sincronizzato", "Sincronizzazione completata.");
    } catch (error) {
      console.error(error);
      const wrongPassword = error?.name === "OperationError";
      setSyncState("error", "Errore GitHub", wrongPassword ? "Password di cifratura errata." : (error.message || "Sincronizzazione non riuscita."), true);
    } finally {
      state.syncing = false;
      if (state.syncQueued) {
        state.syncQueued = false;
        setTimeout(() => reconcileWithRemote(), 250);
      }
    }
  }

  function scheduleSync() {
    if (!getToken() || !getPassphrase()) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => reconcileWithRemote(), 1800);
  }

  async function connectGithub(event) {
    event.preventDefault();
    const token = el("githubTokenInput").value.trim();
    const passphrase = el("githubPassInput").value;
    const remember = el("rememberGithubSync").checked;
    if (!token || passphrase.length < 10) {
      showSyncMessage("Inserisci il token e una password di almeno 10 caratteri.", true);
      return;
    }

    showSyncMessage("Verifica dell’accesso in corso…");
    try {
      const response = await fetch(GITHUB_API, { headers: apiHeaders(token), cache: "no-store" });
      if (!response.ok) throw new Error("Token non valido o senza accesso al repository.");
      setCredentials(token, passphrase, remember);
      await reconcileWithRemote();
      closeDialog("syncDialog");
      showToast("GitHub collegato correttamente");
    } catch (error) {
      console.error(error);
      showSyncMessage(error.message || "Collegamento non riuscito.", true);
      setSyncState("error", "Errore GitHub");
    }
  }

  function disconnectGithub() {
    clearCredentials();
    localStorage.removeItem(LAST_SYNC_KEY);
    setSyncState("idle", "Salva su GitHub");
    closeDialog("syncDialog");
    showToast("GitHub disconnesso");
  }

  function openSyncDialog() {
    el("githubTokenInput").value = getToken();
    el("githubPassInput").value = getPassphrase();
    el("rememberGithubSync").checked = Boolean(localStorage.getItem(TOKEN_KEY));
    el("syncMessage").classList.add("hidden");
    el("pullRemote").disabled = !(getToken() && getPassphrase());
    el("disconnectGithubSync").disabled = !(getToken() || getPassphrase());
    el("syncDialog").showModal();
  }

  async function unregisterLegacyServiceWorkers() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter((registration) => registration.scope.includes("/TrackPack/"))
        .map((registration) => registration.unregister()));
    } catch (error) {
      console.warn("Impossibile rimuovere il vecchio service worker", error);
    }
  }

  function bindEvents() {
    el("carrierGrid").innerHTML = CARRIERS.map((carrier) => `<button type="button" class="carrier-option" data-carrier="${carrier}">${carrier}</button>`).join("");

    el("carrierGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-carrier]");
      if (button) selectCarrier(button.dataset.carrier);
    });

    el("trackingCode").addEventListener("input", (event) => {
      const code = event.target.value.replace(/\s/g, "");
      event.target.value = code;
      if (!el("carrier").value && /^\d{24}$/.test(code)) selectCarrier("INPOST");
    });

    el("openAddDialog").addEventListener("click", () => {
      resetAddForm();
      el("addDialog").showModal();
    });

    el("githubSyncFab").addEventListener("click", openSyncDialog);

    document.addEventListener("click", (event) => {
      const closer = event.target.closest("[data-close]");
      if (closer) closeDialog(closer.dataset.close);
      const openMenu = event.target.closest("details.card-menu");
      if (!openMenu) closeAllMenus();
    });

    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    el("addForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const code = el("trackingCode").value.trim().replace(/\s/g, "").toUpperCase();
      const carrier = el("carrier").value;
      const error = el("formError");
      if (code.length < 3 || !carrier) {
        error.textContent = "Inserisci un codice valido e seleziona il corriere.";
        error.classList.remove("hidden");
        return;
      }
      if (state.packages.some((pkg) => pkg.trackingCode.replace(/\s/g, "").toUpperCase() === code)) {
        error.textContent = "Questo codice tracking è già presente.";
        error.classList.remove("hidden");
        return;
      }
      const stamp = new Date().toISOString();
      state.packages.unshift(normalizePackage({
        id: uuid(),
        trackingCode: code,
        carrier,
        description: cleanText(el("description").value),
        status: "pending",
        origin: cleanText(el("origin").value),
        destination: cleanText(el("destination").value),
        estimatedDelivery: el("estimatedDelivery").value || undefined,
        isArchived: false,
        createdAt: stamp,
        updatedAt: stamp
      }));
      persistPackages();
      closeDialog("addDialog");
      showToast("Pacco aggiunto");
    });

    el("searchInput").addEventListener("input", (event) => {
      state.search = event.target.value.trim();
      renderPackages();
    });

    el("sortSelect").addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderPackages();
    });

    document.querySelector(".tabs").addEventListener("click", (event) => {
      const tab = event.target.closest("[data-view]");
      if (!tab) return;
      state.view = tab.dataset.view;
      state.filter = "all";
      renderPackages();
    });

    el("statusFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      renderPackages();
    });

    el("packageList").addEventListener("click", async (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const card = action.closest("[data-id]");
      const pkg = state.packages.find((item) => item.id === card?.dataset.id);
      if (!pkg) return;
      closeAllMenus();

      switch (action.dataset.action) {
        case "copy":
          try {
            await navigator.clipboard.writeText(pkg.trackingCode);
            showToast("Codice copiato");
          } catch {
            showToast("Copia non riuscita");
          }
          break;
        case "rename":
          state.selectedId = pkg.id;
          el("renameInput").value = pkg.description || pkg.trackingCode;
          el("renameDialog").showModal();
          requestAnimationFrame(() => el("renameInput").select());
          break;
        case "archive":
          updatePackage(pkg.id, { isArchived: !pkg.isArchived });
          break;
        case "status":
          state.selectedId = pkg.id;
          el("statusDescription").textContent = pkg.description || pkg.trackingCode;
          el("statusSelect").value = pkg.status;
          el("statusDialog").showModal();
          break;
        case "delete":
          state.selectedId = pkg.id;
          el("deleteDescription").textContent = `Vuoi eliminare “${pkg.description || pkg.trackingCode}”?`;
          el("deleteDialog").showModal();
          break;
        case "track-inpost":
          await openInpostTracking(pkg);
          break;
        default:
          break;
      }
    });

    el("renameForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = el("renameInput").value.trim();
      if (!name || !state.selectedId) return;
      updatePackage(state.selectedId, { description: name });
      closeDialog("renameDialog");
      showToast("Nome aggiornato");
    });

    el("statusForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const status = normalizeStatus(el("statusSelect").value);
      updatePackage(state.selectedId, {
        status,
        deliveredAt: status === "delivered" ? new Date().toISOString() : undefined
      });
      closeDialog("statusDialog");
    });

    el("deleteForm").addEventListener("submit", (event) => {
      event.preventDefault();
      state.packages = state.packages.filter((pkg) => pkg.id !== state.selectedId);
      persistPackages();
      closeDialog("deleteDialog");
      showToast("Pacco eliminato");
    });

    el("syncForm").addEventListener("submit", connectGithub);
    el("disconnectGithubSync").addEventListener("click", disconnectGithub);
    el("pullRemote").addEventListener("click", async () => {
      if (!(getToken() && getPassphrase())) {
        showSyncMessage("Collega prima GitHub.", true);
        return;
      }
      await reconcileWithRemote({ forcePull: true });
      showToast("Dati scaricati da GitHub");
    });

    const updateConnection = () => {
      const online = navigator.onLine;
      el("connectionStatus").textContent = online ? "● Online" : "● Offline";
      el("connectionStatus").classList.toggle("offline", !online);
      if (online && getToken() && getPassphrase()) reconcileWithRemote();
    };
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    updateConnection();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        if (getToken() && getPassphrase()) reconcileWithRemote();
        refreshInpostStatuses();
      }
    });
  }

  async function init() {
    try {
      await unregisterLegacyServiceWorkers();
      state.packages = loadPackages();
      bindEvents();
      renderAll();
      if (getToken() && getPassphrase()) {
        setSyncState("syncing", "Controllo GitHub…");
        setTimeout(() => reconcileWithRemote(), 350);
      } else {
        setSyncState("idle", "Salva su GitHub");
      }
      setTimeout(refreshInpostStatuses, 900);
      setInterval(refreshInpostStatuses, 15 * 60 * 1000);
    } catch (error) {
      console.error(error);
      document.body.innerHTML = '<main class="container"><div class="warning">L’app non si è caricata correttamente. I pacchi salvati non sono stati cancellati. Chiudi la pagina e riaprila.</div></main>';
    }
  }

  init();
})();
