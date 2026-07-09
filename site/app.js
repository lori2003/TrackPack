(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const SEED_CODE = "827049017600018049468336";
  const CARRIERS = ["Amazon", "BRT", "DHL", "DPD", "FedEx", "GLS", "INPOST", "Poste Italiane", "SDA", "UPS", "Altro"];
  const STATUSES = {
    pending: "In attesa",
    in_transit: "In transito",
    out_for_delivery: "In consegna",
    delivered: "Consegnato",
    exception: "Problema"
  };
  const STATUS_ORDER = ["pending", "in_transit", "out_for_delivery", "delivered", "exception"];

  const state = { packages: [], view: "active", filter: "all", search: "", sort: "dateDesc", selectedId: null, storageOk: true };
  const el = (id) => document.getElementById(id);

  function uuid() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cleanText(value, max = 255) {
    const text = String(value || "").trim().slice(0, max);
    return text || undefined;
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

  function seedPackage() {
    const stamp = new Date().toISOString();
    return { id: "inpost-seed-827049017600018049468336", trackingCode: SEED_CODE, carrier: "INPOST", description: "Pacco INPOST", status: "pending", isArchived: false, createdAt: stamp, updatedAt: stamp };
  }

  function normalizePackage(value) {
    if (!value || typeof value !== "object") return null;
    const trackingCode = cleanText(value.trackingCode, 100);
    const carrier = cleanText(value.carrier, 100);
    if (!trackingCode || !carrier) return null;
    const status = Object.hasOwn(STATUSES, value.status) ? value.status : "pending";
    const createdAt = !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : new Date().toISOString();
    return {
      id: cleanText(value.id, 100) || uuid(), trackingCode, carrier,
      description: cleanText(value.description), status,
      origin: cleanText(value.origin), destination: cleanText(value.destination),
      estimatedDelivery: value.estimatedDelivery && !Number.isNaN(Date.parse(value.estimatedDelivery)) ? value.estimatedDelivery : undefined,
      deliveredAt: value.deliveredAt && !Number.isNaN(Date.parse(value.deliveredAt)) ? value.deliveredAt : undefined,
      isArchived: value.isArchived === true || value.isArchived === "true",
      createdAt,
      updatedAt: !Number.isNaN(Date.parse(value.updatedAt)) ? value.updatedAt : createdAt
    };
  }

  function loadPackages() {
    state.storageOk = storageAvailable();
    if (!state.storageOk) return [seedPackage()];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const initial = [seedPackage()];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
        return initial;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Invalid storage");
      return parsed.map(normalizePackage).filter(Boolean);
    } catch {
      const initial = [seedPackage()];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch {}
      return initial;
    }
  }

  function savePackages() {
    if (!storageAvailable()) {
      state.storageOk = false;
      updateStorageNotice();
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.packages));
      state.storageOk = true;
    } catch {
      state.storageOk = false;
    }
    updateStorageNotice();
  }

  function updateStorageNotice() {
    el("storageWarning").classList.toggle("hidden", state.storageOk);
    el("storageLabel").textContent = state.storageOk ? "Salvati su questo dispositivo" : "Sessione temporanea";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("it-IT").format(date);
  }

  function trackingUrl(pkg) {
    const code = encodeURIComponent(pkg.trackingCode);
    switch (pkg.carrier.toUpperCase()) {
      case "INPOST": return "https://inpost.it/trova-il-tuo-pacco";
      case "DHL": return `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${code}`;
      case "FEDEX": return `https://www.fedex.com/fedextrack/?trknbr=${code}`;
      case "UPS": return `https://www.ups.com/track?tracknum=${code}`;
      case "POSTE ITALIANE":
      case "SDA": return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${code}`;
      default: return "";
    }
  }

  function getVisiblePackages() {
    const query = state.search.toLowerCase();
    const visible = state.packages.filter((pkg) => state.view === "active" ? !pkg.isArchived : pkg.isArchived)
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
    const counts = { all: active.length };
    active.forEach((pkg) => counts[pkg.status] = (counts[pkg.status] || 0) + 1);
    el("activeCount").textContent = counts.all;
    el("statusFilters").classList.toggle("hidden", state.view === "archived");
    el("statusFilters").innerHTML = ["all", ...STATUS_ORDER].map((status) => {
      const label = status === "all" ? "Tutti" : STATUSES[status];
      const count = counts[status] ? ` (${counts[status]})` : "";
      return `<button class="filter ${state.filter === status ? "active" : ""}" data-filter="${status}">${label}${count}</button>`;
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
      const progress = pkg.status === "delivered" ? 100 : pkg.status === "exception" ? 0 : ((Math.max(STATUS_ORDER.indexOf(pkg.status), 0) + 1) / 4) * 100;
      const route = pkg.origin || pkg.destination ? `<div class="meta-row"><span>⌖</span><span>${escapeHtml(pkg.origin || "?")} → ${escapeHtml(pkg.destination || "?")}</span></div>` : "";
      const delivered = formatDate(pkg.deliveredAt);
      const estimate = formatDate(pkg.estimatedDelivery);
      const dateRow = delivered || estimate ? `<div class="meta-row"><span>◷</span><span>${delivered ? `Consegnato il ${delivered}` : `Stima: ${estimate}`}</span></div>` : "";
      const url = trackingUrl(pkg);
      return `<article class="package-card ${pkg.status}" data-id="${escapeHtml(pkg.id)}">
        ${pkg.status === "exception" ? "" : `<div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>`}
        <div class="card-inner">
          <div class="card-head">
            <div class="card-title-wrap"><span class="badge ${pkg.status}">${STATUSES[pkg.status]}</span><h2 class="package-title">${escapeHtml(pkg.description || pkg.trackingCode)}</h2></div>
            <details class="card-menu"><summary aria-label="Azioni">⋮</summary><div class="menu-pop">
              <button data-action="status">Cambia stato</button>
              <button data-action="archive">${pkg.isArchived ? "Ripristina" : "Archivia"}</button>
              <button class="delete-action" data-action="delete">Elimina</button>
            </div></details>
          </div>
          <div class="meta"><div class="meta-row"><span>▣</span><span class="mono">${escapeHtml(pkg.trackingCode)}</span><span>· ${escapeHtml(pkg.carrier)}</span></div>${route}${dateRow}</div>
          <div class="card-actions">
            <button class="button secondary small" data-action="copy">⧉ Copia codice</button>
            ${url ? `<a class="button primary small" href="${url}" target="_blank" rel="noreferrer">↗ Traccia sul sito</a>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
  }

  function updatePackage(id, updates) {
    state.packages = state.packages.map((pkg) => pkg.id === id ? { ...pkg, ...updates, id: pkg.id, updatedAt: new Date().toISOString() } : pkg);
    savePackages();
    renderPackages();
  }

  function closeDialog(id) {
    const dialog = el(id);
    if (dialog?.open) dialog.close();
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
    el("openAddDialog").addEventListener("click", () => { resetAddForm(); el("addDialog").showModal(); });
    document.addEventListener("click", (event) => {
      const closer = event.target.closest("[data-close]");
      if (closer) closeDialog(closer.dataset.close);
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
      state.packages.unshift({ id: uuid(), trackingCode: code, carrier, description: cleanText(el("description").value), status: "pending", origin: cleanText(el("origin").value), destination: cleanText(el("destination").value), estimatedDelivery: el("estimatedDelivery").value || undefined, isArchived: false, createdAt: stamp, updatedAt: stamp });
      savePackages();
      closeDialog("addDialog");
      renderPackages();
    });
    el("searchInput").addEventListener("input", (event) => { state.search = event.target.value.trim(); renderPackages(); });
    el("sortSelect").addEventListener("change", (event) => { state.sort = event.target.value; renderPackages(); });
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
      card.querySelector("details")?.removeAttribute("open");
      if (action.dataset.action === "copy") {
        try { await navigator.clipboard.writeText(pkg.trackingCode); action.textContent = "✓ Copiato"; setTimeout(() => action.textContent = "⧉ Copia codice", 1200); } catch {}
      } else if (action.dataset.action === "archive") {
        updatePackage(pkg.id, { isArchived: !pkg.isArchived });
      } else if (action.dataset.action === "status") {
        state.selectedId = pkg.id;
        el("statusDescription").textContent = pkg.description || pkg.trackingCode;
        el("statusSelect").value = pkg.status;
        el("statusDialog").showModal();
      } else if (action.dataset.action === "delete") {
        state.selectedId = pkg.id;
        el("deleteDescription").textContent = `Vuoi eliminare “${pkg.description || pkg.trackingCode}”? L’azione non può essere annullata.`;
        el("deleteDialog").showModal();
      }
    });
    el("statusForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const status = el("statusSelect").value;
      updatePackage(state.selectedId, { status, deliveredAt: status === "delivered" ? new Date().toISOString() : undefined });
      closeDialog("statusDialog");
    });
    el("deleteForm").addEventListener("submit", (event) => {
      event.preventDefault();
      state.packages = state.packages.filter((pkg) => pkg.id !== state.selectedId);
      savePackages();
      closeDialog("deleteDialog");
      renderPackages();
    });
    const updateConnection = () => {
      const online = navigator.onLine;
      el("connectionStatus").textContent = online ? "● Online" : "● Offline";
      el("connectionStatus").classList.toggle("offline", !online);
    };
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    updateConnection();
  }

  function init() {
    try {
      state.packages = loadPackages();
      updateStorageNotice();
      bindEvents();
      renderPackages();
      if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
    } catch (error) {
      console.error(error);
      document.body.innerHTML = '<main class="container"><div class="warning">L’app non si è caricata correttamente. Ricarica la pagina: i pacchi già salvati non vengono eliminati.</div></main>';
    }
  }

  init();
})();
