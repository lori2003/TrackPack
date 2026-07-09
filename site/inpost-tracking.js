(() => {
  "use strict";

  const API_BASE = "https://api-shipx-pl.easypack24.net/v1/tracking/";
  const STORAGE_KEY = "trackpack.packages.v3";

  const STATUS_LABELS = {
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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'\"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;"
    })[char]);
  }

  function humanizeStatus(status) {
    const key = String(status || "").toLowerCase();
    if (STATUS_LABELS[key]) return STATUS_LABELS[key];
    return key ? key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "Stato non disponibile";
  }

  function appStatus(status) {
    const key = String(status || "").toLowerCase();
    if (key === "delivered") return "delivered";
    if (["out_for_delivery", "ready_to_pickup"].includes(key)) return "out_for_delivery";
    if (["returned_to_sender", "returned_to_sender_accepted", "canceled", "claim", "missing", "damaged"].includes(key)) return "exception";
    if (["created", "confirmed", "offers_prepared"].includes(key)) return "pending";
    return "in_transit";
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data non disponibile";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function ensureUi() {
    if (!document.getElementById("liveTrackingDialog")) {
      const dialog = document.createElement("dialog");
      dialog.id = "liveTrackingDialog";
      dialog.className = "modal";
      dialog.innerHTML = `
        <div style="padding:20px">
          <div class="modal-head">
            <div><h2>Tracking INPOST</h2><p id="liveTrackingCode"></p></div>
            <button class="icon-button" id="closeLiveTracking" type="button" aria-label="Chiudi">×</button>
          </div>
          <div id="liveTrackingContent" aria-live="polite"></div>
        </div>`;
      document.body.appendChild(dialog);
      document.getElementById("closeLiveTracking").addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    if (!document.getElementById("liveTrackingStyles")) {
      const style = document.createElement("style");
      style.id = "liveTrackingStyles";
      style.textContent = `
        .live-summary{padding:14px;border:1px solid #bfdbfe;border-radius:14px;background:#eff6ff;margin-bottom:14px}
        .live-summary strong{display:block;font-size:17px;color:#1e3a8a}
        .live-summary span{display:block;margin-top:5px;font-size:12px;color:#64748b}
        .live-place{padding:12px;border:1px solid #e4e4e7;border-radius:12px;margin-bottom:14px;font-size:13px;line-height:1.5}
        .live-place strong{display:block;margin-bottom:3px}
        .live-timeline{position:relative;display:grid;gap:0;margin-top:8px}
        .live-event{position:relative;padding:0 0 18px 27px}
        .live-event:before{content:"";position:absolute;left:5px;top:7px;width:9px;height:9px;border-radius:50%;background:#2563eb;box-shadow:0 0 0 4px #dbeafe}
        .live-event:not(:last-child):after{content:"";position:absolute;left:9px;top:19px;bottom:0;width:2px;background:#dbeafe}
        .live-event strong{display:block;font-size:14px}
        .live-event time{display:block;margin-top:3px;color:#71717a;font-size:12px}
        .live-error{padding:13px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#991b1b;font-size:13px;line-height:1.45}
        .live-loading{padding:28px 8px;text-align:center;color:#71717a;font-size:14px}
      `;
      document.head.appendChild(style);
    }
  }

  function syncStoredPackage(trackingCode, rawStatus) {
    try {
      const packages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(packages)) return;
      const normalized = appStatus(rawStatus);
      let changed = false;
      for (const pkg of packages) {
        if (String(pkg.trackingCode).replace(/\s/g, "") === trackingCode.replace(/\s/g, "")) {
          pkg.status = normalized;
          pkg.updatedAt = new Date().toISOString();
          if (normalized === "delivered" && !pkg.deliveredAt) pkg.deliveredAt = new Date().toISOString();
          changed = true;
        }
      }
      if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(packages));
    } catch {}
  }

  function updateCard(card, rawStatus) {
    const normalized = appStatus(rawStatus);
    const labels = { pending: "In attesa", in_transit: "In transito", out_for_delivery: "In consegna", delivered: "Consegnato", exception: "Problema" };
    card.classList.remove("pending", "in_transit", "out_for_delivery", "delivered", "exception");
    card.classList.add(normalized);
    const badge = card.querySelector(".badge");
    if (badge) {
      badge.className = `badge ${normalized}`;
      badge.textContent = labels[normalized];
    }
    const progress = card.querySelector(".progress-bar");
    if (progress) progress.style.width = normalized === "delivered" ? "100%" : normalized === "out_for_delivery" ? "75%" : normalized === "in_transit" ? "50%" : "25%";
  }

  function renderTracking(data) {
    const details = Array.isArray(data.tracking_details) ? [...data.tracking_details] : [];
    details.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    const machine = data.custom_attributes?.target_machine_detail;
    const place = machine?.name || machine?.address?.line1 || machine?.address?.line2
      ? `<div class="live-place"><strong>Punto di ritiro o consegna</strong>${escapeHtml(machine?.name || "")}<br>${escapeHtml(machine?.address?.line1 || "")} ${escapeHtml(machine?.address?.line2 || "")}</div>`
      : "";
    const timeline = details.length
      ? `<div class="live-timeline">${details.map((item) => `<div class="live-event"><strong>${escapeHtml(humanizeStatus(item.status || item.origin_status))}</strong><time>${escapeHtml(formatDateTime(item.datetime))}</time></div>`).join("")}</div>`
      : `<div class="live-error">INPOST non ha ancora pubblicato eventi dettagliati per questa spedizione.</div>`;
    return `<div class="live-summary"><strong>${escapeHtml(humanizeStatus(data.status))}</strong><span>Aggiornato: ${escapeHtml(formatDateTime(data.updated_at || data.created_at))}</span></div>${place}${timeline}`;
  }

  async function openTracking(card, button) {
    ensureUi();
    const dialog = document.getElementById("liveTrackingDialog");
    const content = document.getElementById("liveTrackingContent");
    const code = card.querySelector(".mono")?.textContent?.trim();
    if (!code) return;
    document.getElementById("liveTrackingCode").textContent = code;
    content.innerHTML = '<div class="live-loading">Controllo dello stato in corso…</div>';
    dialog.showModal();
    const original = button.textContent;
    button.textContent = "Controllo…";
    button.setAttribute("aria-busy", "true");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(`${API_BASE}${encodeURIComponent(code)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(response.status === 404 ? "Spedizione non trovata" : `Errore INPOST (${response.status})`);
      const data = await response.json();
      content.innerHTML = renderTracking(data);
      syncStoredPackage(code, data.status);
      updateCard(card, data.status);
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "INPOST sta impiegando troppo tempo a rispondere. Riprova tra poco."
        : error?.message === "Spedizione non trovata"
          ? "Il codice non risulta ancora nei sistemi INPOST. Potrebbe essere troppo recente oppure non appartenere alla rete supportata."
          : "Non è stato possibile recuperare il tracking in questo momento. Riprova più tardi.";
      content.innerHTML = `<div class="live-error">${escapeHtml(message)}</div>`;
    } finally {
      button.textContent = original;
      button.removeAttribute("aria-busy");
    }
  }

  function enhanceCards(root = document) {
    root.querySelectorAll?.(".package-card").forEach((card) => {
      const meta = card.querySelector(".meta")?.textContent?.toUpperCase() || "";
      if (!meta.includes("INPOST")) return;
      const link = card.querySelector('a.button.primary[href*="inpost"]');
      if (!link || link.dataset.liveTracking === "true") return;
      link.dataset.liveTracking = "true";
      link.textContent = "⌁ Controlla tracking";
      link.removeAttribute("target");
      link.removeAttribute("rel");
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest('a[data-live-tracking="true"]');
    if (!button) return;
    event.preventDefault();
    const card = button.closest(".package-card");
    if (card) openTracking(card, button);
  }, true);

  const observer = new MutationObserver(() => enhanceCards());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => enhanceCards());
})();
