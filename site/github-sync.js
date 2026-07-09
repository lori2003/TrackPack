(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const TOKEN_KEY = "trackpack.github.token";
  const PASS_KEY = "trackpack.github.passphrase";
  const REPO = "lori2003/TrackPack";
  const BRANCH = "main";
  const DATA_PATH = "data/packages.enc.json";
  const API = `https://api.github.com/repos/${REPO}`;
  const nativeSetItem = Storage.prototype.setItem;

  let applyingRemote = false;
  let syncTimer = null;
  let syncing = false;

  function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value.replace(/\s/g, ""));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function utf8ToBase64(value) {
    return bytesToBase64(new TextEncoder().encode(value));
  }

  function base64ToUtf8(value) {
    return new TextDecoder().decode(base64ToBytes(value));
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
  }

  function getPassphrase() {
    return sessionStorage.getItem(PASS_KEY) || localStorage.getItem(PASS_KEY) || "";
  }

  function apiHeaders(token = getToken()) {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function deriveKey(passphrase, salt) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptPackages(packages, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(packages));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    return {
      version: 1,
      algorithm: "AES-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: 210000,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      updatedAt: new Date().toISOString()
    };
  }

  async function decryptPackages(payload, passphrase) {
    if (!payload || payload.version !== 1) throw new Error("Formato dati non riconosciuto");
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const ciphertext = base64ToBytes(payload.ciphertext);
    const key = await deriveKey(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (!Array.isArray(parsed)) throw new Error("Dati non validi");
    return parsed;
  }

  async function fetchRemoteFile(token = getToken()) {
    const response = await fetch(`${API}/contents/${DATA_PATH}?ref=${encodeURIComponent(BRANCH)}&t=${Date.now()}`, {
      headers: apiHeaders(token),
      cache: "no-store"
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ha risposto con errore ${response.status}`);
    return response.json();
  }

  async function uploadPackages() {
    if (syncing || applyingRemote) return;
    const token = getToken();
    const passphrase = getPassphrase();
    if (!token || !passphrase) return;

    syncing = true;
    setSyncState("syncing", "Sincronizzazione…");
    try {
      const packages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(packages)) throw new Error("Dati locali non validi");
      const encrypted = await encryptPackages(packages, passphrase);
      const current = await fetchRemoteFile(token);
      const body = {
        message: `Sync TrackPack ${new Date().toISOString()}`,
        content: utf8ToBase64(JSON.stringify(encrypted, null, 2)),
        branch: BRANCH
      };
      if (current?.sha) body.sha = current.sha;
      const response = await fetch(`${API}/contents/${DATA_PATH}`, {
        method: "PUT",
        headers: { ...apiHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        throw new Error(details.message || `Errore GitHub ${response.status}`);
      }
      localStorage.setItem("trackpack.github.lastSync", new Date().toISOString());
      setSyncState("ok", "Salvati su GitHub");
    } catch (error) {
      console.error(error);
      setSyncState("error", "Errore sincronizzazione");
      showMessage(error.message || "Sincronizzazione non riuscita", true);
    } finally {
      syncing = false;
    }
  }

  function scheduleUpload() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(uploadPackages, 3500);
  }

  Storage.prototype.setItem = function (key, value) {
    const result = nativeSetItem.call(this, key, value);
    if (this === localStorage && key === STORAGE_KEY && !applyingRemote) scheduleUpload();
    return result;
  };

  function injectStyles() {
    if (document.getElementById("githubSyncStyles")) return;
    const style = document.createElement("style");
    style.id = "githubSyncStyles";
    style.textContent = `
      .sync-button{border:1px solid #e4e4e7;background:#fff;border-radius:999px;min-height:36px;padding:0 11px;font-size:12px;font-weight:700;white-space:nowrap}
      .sync-button[data-state="ok"]{color:#166534;border-color:#bbf7d0;background:#f0fdf4}
      .sync-button[data-state="error"]{color:#991b1b;border-color:#fecaca;background:#fef2f2}
      .sync-note{padding:11px 12px;border-radius:11px;background:#f4f4f5;color:#52525b;font-size:12px;line-height:1.45;margin-bottom:14px}
      .sync-message{padding:10px 12px;border-radius:10px;background:#eff6ff;color:#1e40af;font-size:13px;margin-top:12px}
      .sync-message.error{background:#fef2f2;color:#991b1b}
      .sync-row{display:flex;align-items:center;gap:8px;font-size:13px;color:#52525b;margin-top:12px}
      .sync-row input{width:18px;height:18px}
      @media(max-width:520px){.sync-button{font-size:0;width:38px;padding:0}.sync-button::before{content:"☁";font-size:18px}}
    `;
    document.head.appendChild(style);
  }

  function ensureUi() {
    injectStyles();
    if (!document.getElementById("githubSyncButton")) {
      const button = document.createElement("button");
      button.id = "githubSyncButton";
      button.className = "sync-button";
      button.type = "button";
      button.textContent = "☁ Configura GitHub";
      const status = document.getElementById("connectionStatus");
      status?.parentElement?.insertBefore(button, status);
      button.addEventListener("click", openDialog);
    }

    if (!document.getElementById("githubSyncDialog")) {
      const dialog = document.createElement("dialog");
      dialog.id = "githubSyncDialog";
      dialog.className = "modal";
      dialog.innerHTML = `
        <form id="githubSyncForm" method="dialog">
          <div class="modal-head">
            <div><h2>Sincronizzazione GitHub</h2><p>I pacchi vengono salvati nel repository e non dipendono più da un solo browser.</p></div>
            <button class="icon-button" id="closeGithubSync" type="button" aria-label="Chiudi">×</button>
          </div>
          <div class="sync-note">I dati vengono cifrati prima del caricamento. Usa un token GitHub fine-grained limitato al solo repository <strong>TrackPack</strong>, con permesso <strong>Contents: Read and write</strong>. Non inserire mai il token nel codice o in chat.</div>
          <label class="field"><span>Token GitHub</span><input id="githubTokenInput" type="password" autocomplete="off" placeholder="github_pat_…" required></label>
          <label class="field"><span>Password di cifratura</span><input id="githubPassInput" type="password" minlength="10" autocomplete="new-password" placeholder="Almeno 10 caratteri" required></label>
          <label class="sync-row"><input id="rememberGithubSync" type="checkbox"> Ricorda token e password su questo dispositivo</label>
          <div id="githubSyncMessage" class="sync-message hidden" role="status"></div>
          <div class="modal-actions">
            <button class="button secondary" id="disconnectGithubSync" type="button">Disconnetti</button>
            <button class="button primary" type="submit">Collega e sincronizza</button>
          </div>
        </form>`;
      document.body.appendChild(dialog);

      const close = () => dialog.close();
      document.getElementById("closeGithubSync").addEventListener("click", close);
      document.getElementById("disconnectGithubSync").addEventListener("click", disconnect);
      dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
      document.getElementById("githubSyncForm").addEventListener("submit", connect);
    }
  }

  function setSyncState(state, text) {
    ensureUi();
    const button = document.getElementById("githubSyncButton");
    button.dataset.state = state;
    button.textContent = `☁ ${text}`;
    const label = document.getElementById("storageLabel");
    if (label && state === "ok") label.textContent = "Cifrati e salvati su GitHub";
  }

  function showMessage(text, isError = false) {
    ensureUi();
    const message = document.getElementById("githubSyncMessage");
    message.textContent = text;
    message.classList.remove("hidden");
    message.classList.toggle("error", isError);
  }

  function openDialog() {
    ensureUi();
    document.getElementById("githubTokenInput").value = getToken();
    document.getElementById("githubPassInput").value = getPassphrase();
    document.getElementById("rememberGithubSync").checked = Boolean(localStorage.getItem(TOKEN_KEY));
    document.getElementById("githubSyncMessage").classList.add("hidden");
    document.getElementById("githubSyncDialog").showModal();
  }

  async function connect(event) {
    event.preventDefault();
    const token = document.getElementById("githubTokenInput").value.trim();
    const passphrase = document.getElementById("githubPassInput").value;
    const remember = document.getElementById("rememberGithubSync").checked;
    if (!token || passphrase.length < 10) {
      showMessage("Inserisci il token e una password di almeno 10 caratteri.", true);
      return;
    }

    showMessage("Verifica dell’accesso in corso…");
    try {
      const test = await fetch(API, { headers: apiHeaders(token), cache: "no-store" });
      if (!test.ok) throw new Error("Token non valido o senza accesso al repository.");

      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(PASS_KEY, passphrase);
      if (remember) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(PASS_KEY, passphrase);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(PASS_KEY);
      }

      const remote = await fetchRemoteFile(token);
      if (remote?.content) {
        const encrypted = JSON.parse(base64ToUtf8(remote.content));
        const packages = await decryptPackages(encrypted, passphrase);
        applyingRemote = true;
        nativeSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(packages));
        applyingRemote = false;
        showMessage("Dati recuperati da GitHub. Ricaricamento…");
        setSyncState("ok", "Salvati su GitHub");
        setTimeout(() => location.reload(), 500);
      } else {
        await uploadPackages();
        showMessage("Sincronizzazione attivata. I dati locali sono stati salvati nel repository.");
        setSyncState("ok", "Salvati su GitHub");
      }
    } catch (error) {
      console.error(error);
      showMessage(error.name === "OperationError" ? "Password di cifratura errata." : error.message, true);
      setSyncState("error", "GitHub non collegato");
    }
  }

  function disconnect() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PASS_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PASS_KEY);
    document.getElementById("githubSyncDialog")?.close();
    setSyncState("idle", "Configura GitHub");
    const label = document.getElementById("storageLabel");
    if (label) label.textContent = "Salvati su questo dispositivo";
  }

  async function restoreOnStartup() {
    ensureUi();
    if (!getToken() || !getPassphrase()) {
      setSyncState("idle", "Configura GitHub");
      return;
    }
    setSyncState("syncing", "Controllo GitHub…");
    try {
      const remote = await fetchRemoteFile();
      if (!remote?.content) {
        await uploadPackages();
        return;
      }
      const encrypted = JSON.parse(base64ToUtf8(remote.content));
      const packages = await decryptPackages(encrypted, getPassphrase());
      applyingRemote = true;
      nativeSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(packages));
      applyingRemote = false;
      setSyncState("ok", "Salvati su GitHub");
      window.dispatchEvent(new Event("trackpack:remote-loaded"));
    } catch (error) {
      console.error(error);
      setSyncState("error", "GitHub non collegato");
    }
  }

  document.addEventListener("DOMContentLoaded", () => setTimeout(restoreOnStartup, 700));
  window.addEventListener("online", () => { if (getToken() && getPassphrase()) restoreOnStartup(); });
})();
