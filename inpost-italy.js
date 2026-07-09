(() => {
  "use strict";

  const WIDGET_SCRIPT = "https://www.17track.net/externalcall.js";
  let widgetPromise = null;

  function loadWidget() {
    if (window.YQV5?.trackSingle) return Promise.resolve();
    if (widgetPromise) return widgetPromise;

    widgetPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById("trackpack17TrackScript");
      if (existing) {
        const started = Date.now();
        const timer = setInterval(() => {
          if (window.YQV5?.trackSingle) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - started > 15000) {
            clearInterval(timer);
            reject(new Error("Widget 17TRACK non disponibile"));
          }
        }, 150);
        return;
      }

      const script = document.createElement("script");
      script.id = "trackpack17TrackScript";
      script.src = WIDGET_SCRIPT;
      script.async = true;
      script.onload = () => {
        if (window.YQV5?.trackSingle) resolve();
        else reject(new Error("Widget 17TRACK non inizializzato"));
      };
      script.onerror = () => reject(new Error("Impossibile caricare 17TRACK"));
      document.head.appendChild(script);
    });

    return widgetPromise;
  }

  function renderFallback(code) {
    const content = document.getElementById("trackingContent");
    content.innerHTML = `
      <div class="live-error">
        Non è stato possibile caricare 17TRACK in questo momento. Controlla la connessione e riprova.
      </div>
      <div style="display:grid;gap:9px;margin-top:14px">
        <button id="retry17Track" class="button primary" type="button">Riprova</button>
        <button id="copy17TrackCode" class="button secondary" type="button">Copia codice ${code}</button>
      </div>`;

    document.getElementById("retry17Track")?.addEventListener("click", () => openTracking(code));
    document.getElementById("copy17TrackCode")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        document.getElementById("copy17TrackCode").textContent = "✓ Codice copiato";
      } catch {}
    });
  }

  async function openTracking(code) {
    const dialog = document.getElementById("trackingDialog");
    const content = document.getElementById("trackingContent");
    const title = dialog.querySelector(".modal-head h2");

    if (title) title.textContent = "Tracking 17TRACK";
    document.getElementById("trackingDialogCode").textContent = code;
    content.innerHTML = '<div class="live-loading">Caricamento del tracking…</div>';
    if (!dialog.open) dialog.showModal();

    try {
      await loadWidget();
      content.innerHTML = '<div id="YQContainer" style="min-height:560px;width:100%;overflow:hidden"></div>';
      window.YQV5.trackSingle({
        YQ_ContainerId: "YQContainer",
        YQ_Height: 620,
        YQ_Fc: "0",
        YQ_Lang: "it",
        YQ_Num: code
      });
    } catch (error) {
      console.error(error);
      widgetPromise = null;
      renderFallback(code);
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="track-inpost"]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const card = button.closest("[data-id]");
    const code = card?.querySelector(".mono")?.textContent?.trim();
    if (code) openTracking(code);
  }, true);
})();
