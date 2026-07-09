(() => {
  "use strict";

  const API_BASE = "https://api-shipx-pl.easypack24.net/v1/tracking/";
  const OFFICIAL_TRACKING = "https://inpost.it/trova-il-tuo-pacco";

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
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function humanize(value) {
    const key = String(value || "").toLowerCase();
    return STATUS_LABELS[key] || (key ? key.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase()) : "Stato non disponibile");
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data non disponibile";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function renderTimeline(data) {
    const details = Array.isArray(data.tracking_details) ? [...data.tracking_details] : [];
    details.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    const timeline = details.length
      ? `<div class="live-timeline">${details.map((item) => `<div class="live-event"><strong>${escapeHtml(humanize(item.status || item.origin_status))}</strong><time>${escapeHtml(formatDateTime(item.datetime))}</time></div>`).join("")}</div>`
      : '<div class="live-error">La fonte automatica non ha restituito eventi dettagliati.</div>';
    return `<div class="live-summary"><strong>${escapeHtml(humanize(data.status))}</strong><span>Aggiornato: ${escapeHtml(formatDateTime(data.updated_at || data.created_at))}</span></div>${timeline}`;
  }

  function renderItalianFallback(code) {
    return `
      <div class="live-error" style="border-color:#fde68a;background:#fffbeb;color:#854d0e">
        <strong style="display:block;margin-bottom:6px">Il pacco può essere già in movimento.</strong>
        TrackPack ha interrogato la fonte automatica ShipX, che non sempre riconosce subito le spedizioni gestite da InPost Italia o provenienti da AliExpress. Questo risultato non significa che il codice sia inesistente.
      </div>
      <div style="display:grid;gap:9px;margin-top:14px">
        <button id="openOfficialInpost" class="button primary" type="button">Apri il tracking ufficiale InPost Italia</button>
        <button id="copyInpostCode" class="button secondary" type="button">Copia codice ${escapeHtml(code)}</button>
      </div>`;
  }

  async function openOfficial(code) {
    try { await navigator.clipboard.writeText(code); } catch {}
    window.open(OFFICIAL_TRACKING, "_blank", "noopener,noreferrer");
  }

  async function checkTracking(code) {
    const dialog = document.getElementById("trackingDialog");
    const content = document.getElementById("trackingContent");
    document.getElementById("trackingDialogCode").textContent = code;
    content.innerHTML = '<div class="live-loading">Controllo dello stato in corso…</div>';
    if (!dialog.open) dialog.showModal();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(`${API_BASE}${encodeURIComponent(code)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        content.innerHTML = renderTimeline(data);
        return;
      }

      if (response.status === 404) {
        content.innerHTML = renderItalianFallback(code);
      } else {
        throw new Error(`Errore ${response.status}`);
      }
    } catch {
      content.innerHTML = renderItalianFallback(code);
    }

    document.getElementById("openOfficialInpost")?.addEventListener("click", () => openOfficial(code));
    document.getElementById("copyInpostCode")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        document.getElementById("copyInpostCode").textContent = "✓ Codice copiato";
      } catch {}
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="track-inpost"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const card = button.closest("[data-id]");
    const code = card?.querySelector(".mono")?.textContent?.trim();
    if (code) checkTracking(code);
  }, true);
})();
