(() => {
  "use strict";

  const INPOST_URL = "https://inpost.it/trova-il-tuo-pacco";

  async function openInpostOfficial(button, code) {
    try {
      await navigator.clipboard.writeText(code);
      button.dataset.originalText ||= button.textContent;
      button.textContent = "✓ Codice copiato";
      setTimeout(() => {
        button.textContent = button.dataset.originalText || "Apri tracking";
      }, 1800);
    } catch {}

    window.open(INPOST_URL, "_blank", "noopener,noreferrer");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="track-inpost"]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const card = button.closest("[data-id]");
    const code = card?.querySelector(".mono")?.textContent?.trim();
    if (code) openInpostOfficial(button, code);
  }, true);
})();
