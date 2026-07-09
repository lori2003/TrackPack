(() => {
  "use strict";

  function openSyncDialog() {
    const dialog = document.getElementById("githubSyncDialog");
    if (dialog && !dialog.open) {
      dialog.showModal();
      return;
    }
    const original = document.getElementById("githubSyncButton");
    if (original) original.click();
  }

  function installButton() {
    let button = document.getElementById("githubSyncFab");
    if (!button) {
      button = document.createElement("button");
      button.id = "githubSyncFab";
      button.type = "button";
      button.textContent = "☁ Salva su GitHub";
      button.setAttribute("aria-label", "Configura il salvataggio su GitHub");
      document.body.appendChild(button);
    }

    if (!button.dataset.bound) {
      button.dataset.bound = "true";
      button.addEventListener("click", openSyncDialog);
    }

    if (!document.getElementById("githubSyncFabStyles")) {
      const style = document.createElement("style");
      style.id = "githubSyncFabStyles";
      style.textContent = `
        #githubSyncFab{
          position:fixed;
          left:16px;
          bottom:calc(22px + env(safe-area-inset-bottom));
          z-index:1000;
          min-height:48px;
          max-width:calc(100vw - 92px);
          border:1px solid #d4d4d8;
          border-radius:999px;
          padding:0 16px;
          background:#fff;
          color:#18181b;
          font:700 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          box-shadow:0 10px 28px rgba(0,0,0,.16);
          display:block!important;
          visibility:visible!important;
          opacity:1!important;
        }
        #githubSyncFab:active{transform:scale(.98)}
        #githubSyncButton{display:none!important}
      `;
      document.head.appendChild(style);
    }
  }

  installButton();
  document.addEventListener("DOMContentLoaded", installButton);
  window.addEventListener("load", installButton);
  setTimeout(installButton, 800);
  setTimeout(installButton, 2200);
})();
