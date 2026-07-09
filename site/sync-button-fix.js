(() => {
  "use strict";

  function installButton() {
    if (document.getElementById("githubSyncFab")) return;

    const button = document.createElement("button");
    button.id = "githubSyncFab";
    button.type = "button";
    button.textContent = "☁ Salva su GitHub";
    button.setAttribute("aria-label", "Configura il salvataggio su GitHub");

    const style = document.createElement("style");
    style.textContent = `
      #githubSyncFab{
        position:fixed;
        left:16px;
        bottom:calc(22px + env(safe-area-inset-bottom));
        z-index:40;
        min-height:48px;
        max-width:calc(100vw - 92px);
        border:1px solid #d4d4d8;
        border-radius:999px;
        padding:0 16px;
        background:#fff;
        color:#18181b;
        font:700 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow:0 10px 28px rgba(0,0,0,.16);
      }
      #githubSyncFab:active{transform:scale(.98)}
      #githubSyncButton{display:none!important}
    `;
    document.head.appendChild(style);
    document.body.appendChild(button);

    button.addEventListener("click", () => {
      const dialog = document.getElementById("githubSyncDialog");
      if (dialog && !dialog.open) {
        dialog.showModal();
        return;
      }
      const original = document.getElementById("githubSyncButton");
      if (original) original.click();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    installButton();
    setTimeout(installButton, 1200);
  });
})();
