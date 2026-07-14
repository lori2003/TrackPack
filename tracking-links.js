(() => {
  "use strict";

  const SUPPORTED = new Set(["INPOST", "POSTE ITALIANE", "SDA", "BRT", "GLS"]);
  const RESULTS_URL = "https://raw.githubusercontent.com/lori2003/TrackPack/main/data/tracking-results.json";
  const ACTIONS_URL = "https://github.com/lori2003/TrackPack/actions";
  const STORAGE_KEY = "trackpack.packages.v3";
  const UPDATED_KEY = "trackpack.local.updatedAt";
  const POLL_INTERVAL_MS = 10000;
  const MAX_POLLS = 24;

  function normalize(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  function cardIdentity(card) {
    const row = card?.querySelector(".meta .meta-row");
    const code = row?.querySelector(".mono")?.textContent?.trim();
    const spans = row ? [...row.querySelectorAll("span")] : [];
    const carrier = spans.at(-1)?.textContent?.replace(/^\s*·\s*/, "").trim();
    return code && carrier ? { code, carrier: normalize(carrier) } : null;
  }

  function officialUrl(carrier, code) {
    const safe = encodeURIComponent(code);
    switch (normalize(carrier)) {
      case "INPOST": return "https://inpost.it/trova-il-tuo-pacco";
      case "POSTE ITALIANE":
      case "SDA": return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${safe}`;
      case "BRT": return `https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numspe_par.htm&Nspedizione=${safe}`;
      case "GLS": return `https://www.gls-italy.com/it/servizi-online/ricerca-spedizioni?match=${safe}`;
      default: return "";
    }
  }

  async function resultKey(carrier, code) {
    const input = new TextEncoder().encode(`${normalize(carrier)}:${normalize(code).replace(/\s+/g, "")}`);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function loadResult(key) {
    const response = await fetch(`${RESULTS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.results?.[key] || null;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function getDialog(code, carrier) {
    const dialog = document.getElementById("trackingDialog");
    const content = document.getElementById("trackingContent");
    const title = dialog?.querySelector(".modal-head h2");
    const subtitle = document.getElementById("trackingDialogCode");

    if (title) title.textContent = `Tracking ${carrier}`;
    if (subtitle) subtitle.textContent = code;
    if (dialog && !dialog.open) dialog.showModal();
    return { dialog, content };
  }

  function clearContent(content) {
    if (content) content.replaceChildren();
  }

  function addMessage(content, className, title, message) {
    const box = document.createElement("div");
    box.className = className;
    const strong = document.createElement("strong");
    strong.textContent = title;
    strong.style.display = "block";
    strong.style.marginBottom = "5px";
    box.appendChild(strong);
    if (message) box.appendChild(document.createTextNode(message));
    content.appendChild(box);
    return box;
  }

  function addActions(content, identity, { retry = false, sync = false } = {}) {
    const actions = document.createElement("div");
    actions.className = "modal-actions";

    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button primary";
      button.textContent = "Riprova controllo";
      button.addEventListener("click", () => checkTracking(identity));
      actions.appendChild(button);
    }

    if (sync) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button primary";
      button.textContent = "Collega GitHub";
      button.addEventListener("click", () => {
        document.getElementById("trackingDialog")?.close();
        document.getElementById("syncDialog")?.showModal();
      });
      actions.appendChild(button);
    }

    const url = officialUrl(identity.carrier, identity.code);
    if (url) {
      const link = document.createElement("a");
      link.className = "button secondary";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Sito ufficiale";
      actions.appendChild(link);
    }

    content.appendChild(actions);
  }

  function renderResult(content, result, heading = "Stato aggiornato") {
    clearContent(content);
    const title = result?.label || "Stato non determinato";
    const checked = formatDateTime(result?.checkedAt);
    const details = [result?.message, checked ? `Controllato ${checked}` : ""].filter(Boolean).join(" · ");
    addMessage(content, "live-summary", heading, `${title}${details ? ` — ${details}` : ""}`);
  }

  function markDeliveredLocally(cardId, checkedAt) {
    try {
      const packages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(packages)) return false;
      let changed = false;
      const now = new Date().toISOString();
      const updated = packages.map((pkg) => {
        if (pkg?.id !== cardId || pkg.status === "delivered") return pkg;
        changed = true;
        return {
          ...pkg,
          status: "delivered",
          deliveredAt: checkedAt || now,
          isArchived: true,
          updatedAt: now
        };
      });
      if (!changed) return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(UPDATED_KEY, now);
      return true;
    } catch {
      return false;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForFreshResult(key, requestedAt, previousCheckedAt) {
    const requestedTime = Date.parse(requestedAt) || Date.now();
    const previousTime = Date.parse(previousCheckedAt || "") || 0;

    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      await sleep(POLL_INTERVAL_MS);
      const result = await loadResult(key).catch(() => null);
      const checkedTime = Date.parse(result?.checkedAt || "") || 0;
      if (result && checkedTime > previousTime && checkedTime >= requestedTime - 3000) return result;
    }
    return null;
  }

  async function checkTracking(identity, cardId = "") {
    const { content } = getDialog(identity.code, identity.carrier);
    if (!content) return;

    clearContent(content);
    const loading = document.createElement("div");
    loading.className = "live-loading";
    loading.textContent = "Avvio del controllo automatico…";
    content.appendChild(loading);

    if (!globalThis.crypto?.subtle) {
      clearContent(content);
      addMessage(content, "live-error", "Browser non compatibile", "Non è possibile calcolare in sicurezza la chiave del tracking.");
      addActions(content, identity);
      return;
    }

    const key = await resultKey(identity.carrier, identity.code);
    const previous = await loadResult(key).catch(() => null);
    const refresh = globalThis.TrackPackRefresh;

    if (!refresh?.requestTrackingUpdate) {
      clearContent(content);
      addMessage(content, "live-error", "Aggiornamento non disponibile", "Ricarica l’ultima versione di TrackPack e riprova.");
      addActions(content, identity, { retry: true });
      return;
    }

    let request;
    try {
      request = await refresh.requestTrackingUpdate();
    } catch (error) {
      clearContent(content);
      addMessage(content, "live-error", "GitHub non ha accettato la richiesta", "Controlla che il token abbia il permesso Contents: Read and write.");
      addActions(content, identity, { retry: true, sync: true });
      return;
    }

    if (!request?.ok) {
      clearContent(content);
      addMessage(content, "live-error", "GitHub non è collegato", "Per avviare il controllo automatico devi salvare token e password di cifratura su questo dispositivo.");
      addActions(content, identity, { sync: true });
      return;
    }

    clearContent(content);
    addMessage(content, "live-summary", "Controllo avviato", "GitHub Actions sta interrogando il sito ufficiale. L’operazione può richiedere da uno a quattro minuti.");
    if (previous) {
      const old = document.createElement("p");
      old.style.margin = "12px 0 0";
      old.style.fontSize = "12px";
      old.style.color = "#6b7280";
      old.textContent = `Ultimo risultato: ${previous.label || "Stato non determinato"}${previous.checkedAt ? ` · ${formatDateTime(previous.checkedAt)}` : ""}`;
      content.appendChild(old);
    }

    const result = await waitForFreshResult(key, request.requestedAt, previous?.checkedAt);
    if (!result) {
      clearContent(content);
      addMessage(content, "live-error", "Il controllo non si è concluso", "Il workflow potrebbe essere ancora in esecuzione oppure essersi fermato. Puoi riprovare o verificare GitHub Actions.");
      const actions = document.createElement("div");
      actions.className = "modal-actions";
      const actionsLink = document.createElement("a");
      actionsLink.className = "button secondary";
      actionsLink.href = ACTIONS_URL;
      actionsLink.target = "_blank";
      actionsLink.rel = "noopener noreferrer";
      actionsLink.textContent = "Controlla Actions";
      actions.appendChild(actionsLink);
      content.appendChild(actions);
      addActions(content, identity, { retry: true });
      return;
    }

    renderResult(content, result);
    addActions(content, identity);

    if (result.state === "delivered" && cardId && markDeliveredLocally(cardId, result.checkedAt)) {
      setTimeout(() => location.reload(), 1200);
    }
  }

  function transformCards() {
    document.querySelectorAll(".package-card[data-id]").forEach((card) => {
      const identity = cardIdentity(card);
      if (!identity || !SUPPORTED.has(identity.carrier)) return;

      const actions = card.querySelector(".card-actions");
      if (!actions) return;
      let primary = actions.querySelector(".button.primary");
      if (primary?.dataset.action === "trackpack-check") return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "button primary";
      button.dataset.action = "trackpack-check";
      button.textContent = "↻ Controlla tracking";

      if (primary) primary.replaceWith(button);
      else actions.appendChild(button);
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="trackpack-check"], [data-action="track-inpost"]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const card = button.closest("[data-id]");
    const identity = cardIdentity(card);
    if (identity) checkTracking(identity, card?.dataset.id || "");
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    transformCards();
    const list = document.getElementById("packageList");
    if (list) new MutationObserver(transformCards).observe(list, { childList: true, subtree: true });
  });
})();
