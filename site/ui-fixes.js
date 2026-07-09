(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const API_BASE = "https://api-shipx-pl.easypack24.net/v1/tracking/";
  const REFRESH_EVERY_MS = 15 * 60 * 1000;
  let selectedId = null;
  let lastRefreshAt = 0;

  const STATUS_MAP = {
    delivered: "delivered",
    out_for_delivery: "out_for_delivery",
    ready_to_pickup: "out_for_delivery",
    returned_to_sender: "exception",
    returned_to_sender_accepted: "exception",
    canceled: "exception",
    claim: "exception",
    missing: "exception",
    damaged: "exception",
    created: "pending",
    confirmed: "pending",
    offers_prepared: "pending"
  };

  const STATUS_LABELS = {
    pending: "In attesa",
    in_transit: "In transito",
    out_for_delivery: "In consegna",
    delivered: "Consegnato",
    exception: "Problema"
  };

  function appStatus(rawStatus) {
    const key = String(rawStatus || "").toLowerCase();
    return STATUS_MAP[key] || "in_transit";
  }

  function injectStyles() {
    if (document.getElementById("trackpackMobileFixes")) return;
    const style = document.createElement("style");
    style.id = "trackpackMobileFixes";
    style.textContent = `
      .package-card{overflow:visible}
      .progress-track{overflow:hidden;border-radius:16px 16px 0 0}
      .card-inner{overflow:visible}
      .card-menu{z-index:10}
      .card-menu[open]{z-index:100}
      .menu-pop{z-index:100;max-width:calc(100vw - 48px)}
      .meta-row{align-items:flex-start;flex-wrap:wrap}
      .meta-row .mono{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-all;max-width:100%}
      .card-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%}
      .card-actions .button{width:100%;min-width:0;padding-inline:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #renameDialog .field{margin-top:0}
      @media(max-width:390px){
        .card-actions{grid-template-columns:1fr}
        .menu-pop{right:-2px}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureRenameDialog() {
    if (document.getElementById("renameDialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "renameDialog";
    dialog.className = "modal small";
    dialog.innerHTML = `
      <form id="renameForm" method="dialog">
        <div class="modal-head">
          <div><h2>Rinomina pacco</h2><p>Scegli un nome più facile da riconoscere.</p></div>
          <button class="icon-button" id="closeRenameDialog" type="button" aria-label="Chiudi">×</button>
        </div>
        <label class="field">
          <span>Nome del pacco</span>
          <input id="renameInput" maxlength="255" placeholder="Es. Scarpe estive" required>
        </label>
        <div class="modal-actions">
          <button class="button secondary" id="cancelRename" type="button">Annulla</button>
          <button class="button primary" type="submit">Salva</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);

    const close = () => dialog.close();
    document.getElementById("closeRenameDialog").addEventListener("click", close);
    document.getElementById("cancelRename").addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    document.getElementById("renameForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = document.getElementById("renameInput").value.trim();
      if (!name || !selectedId) return;
      try {
        const packages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(packages)) return;
        const pkg = packages.find((item) => item.id === selectedId);
        if (!pkg) return;
        pkg.description = name;
        pkg.updatedAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(packages));
        dialog.close();
        location.reload();
      } catch {
        dialog.close();
      }
    });
  }

  function enhanceMenus() {
    document.querySelectorAll(".package-card").forEach((card) => {
      const menu = card.querySelector(".menu-pop");
      if (!menu || menu.querySelector('[data-action="rename"]')) return;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "rename";
      button.textContent = "Rinomina";
      menu.insertBefore(button, menu.firstChild);
    });
  }

  function openRename(card) {
    ensureRenameDialog();
    selectedId = card.dataset.id || null;
    let currentName = card.querySelector(".package-title")?.textContent?.trim() || "";
    try {
      const packages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const pkg = Array.isArray(packages) ? packages.find((item) => item.id === selectedId) : null;
      if (pkg?.description) currentName = pkg.description;
    } catch {}
    const input = document.getElementById("renameInput");
    input.value = currentName;
    document.getElementById("renameDialog").showModal();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function saveLiveStatus(code, normalized, data) {
    try {
      const packages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(packages)) return;
      const pkg = packages.find((item) => String(item.trackingCode).replace(/\s/g, "") === code.replace(/\s/g, ""));
      if (!pkg) return;
      pkg.status = normalized;
      pkg.updatedAt = new Date().toISOString();
      if (normalized === "delivered") {
        const deliveredEvent = Array.isArray(data.tracking_details)
          ? data.tracking_details.find((item) => String(item.status).toLowerCase() === "delivered")
          : null;
        pkg.deliveredAt = deliveredEvent?.datetime || pkg.deliveredAt || new Date().toISOString();
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(packages));
    } catch {}
  }

  function updateCard(card, normalized) {
    card.classList.remove("pending", "in_transit", "out_for_delivery", "delivered", "exception");
    card.classList.add(normalized);
    const badge = card.querySelector(".badge");
    if (badge) {
      badge.className = `badge ${normalized}`;
      badge.textContent = STATUS_LABELS[normalized];
    }
    const progress = card.querySelector(".progress-bar");
    if (progress) {
      const widths = { pending: 25, in_transit: 50, out_for_delivery: 75, delivered: 100, exception: 0 };
      progress.style.width = `${widths[normalized]}%`;
    }
  }

  async function refreshInpostCard(card) {
    const meta = card.querySelector(".meta")?.textContent?.toUpperCase() || "";
    if (!meta.includes("INPOST")) return;
    const code = card.querySelector(".mono")?.textContent?.trim();
    if (!code) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${API_BASE}${encodeURIComponent(code)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) return;
      const data = await response.json();
      const normalized = appStatus(data.status);
      saveLiveStatus(code, normalized, data);
      updateCard(card, normalized);
    } catch {}
  }

  async function refreshAllInpost() {
    if (!navigator.onLine || document.hidden) return;
    lastRefreshAt = Date.now();
    const cards = [...document.querySelectorAll(".package-card")];
    await Promise.allSettled(cards.map(refreshInpostCard));
  }

  document.addEventListener("click", (event) => {
    const rename = event.target.closest('[data-action="rename"]');
    if (!rename) return;
    const card = rename.closest(".package-card");
    card?.querySelector("details")?.removeAttribute("open");
    if (card) openRename(card);
  });

  injectStyles();
  ensureRenameDialog();
  const observer = new MutationObserver(() => enhanceMenus());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => {
    enhanceMenus();
    setTimeout(refreshAllInpost, 1200);
  });
  window.addEventListener("online", refreshAllInpost);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastRefreshAt > 2 * 60 * 1000) refreshAllInpost();
  });
  setInterval(refreshAllInpost, REFRESH_EVERY_MS);
})();
