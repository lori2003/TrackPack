(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const UPDATED_KEY = "trackpack.local.updatedAt";
  let reloadScheduled = false;

  function archiveDeliveredPackages() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const packages = JSON.parse(raw);
      if (!Array.isArray(packages)) return false;

      let changed = false;
      const now = new Date().toISOString();
      const updated = packages.map((pkg) => {
        if (!pkg || typeof pkg !== "object") return pkg;
        const delivered = String(pkg.status || "").toLowerCase() === "delivered";
        if (delivered && pkg.isArchived !== true) {
          changed = true;
          return { ...pkg, isArchived: true, updatedAt: now };
        }
        return pkg;
      });

      if (!changed) return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(UPDATED_KEY, now);
      return true;
    } catch (error) {
      console.warn("Impossibile archiviare i pacchi consegnati", error);
      return false;
    }
  }

  function addRefreshButton() {
    const host = document.querySelector(".header-actions");
    if (!host || document.getElementById("forceRefreshButton")) return;

    const button = document.createElement("button");
    button.id = "forceRefreshButton";
    button.type = "button";
    button.className = "icon-button";
    button.setAttribute("aria-label", "Aggiorna forzatamente TrackPack");
    button.title = "Aggiorna forzatamente";
    button.textContent = "↻";
    button.style.width = "36px";
    button.style.height = "36px";
    button.style.fontSize = "22px";
    button.style.flex = "0 0 auto";

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "⟳";
      button.style.animation = "trackpack-spin .8s linear infinite";

      archiveDeliveredPackages();

      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations
            .filter((registration) => registration.scope.includes("/TrackPack/"))
            .map((registration) => registration.unregister()));
        }

        if ("caches" in window) {
          const names = await caches.keys();
          await Promise.all(names.map((name) => caches.delete(name)));
        }
      } catch (error) {
        console.warn("Pulizia cache non completata", error);
      }

      const url = new URL(location.href);
      url.searchParams.set("refresh", Date.now().toString());
      location.replace(url.toString());
    });

    host.prepend(button);
  }

  function scheduleReloadIfNeeded() {
    if (reloadScheduled) return;

    const activeTab = document.querySelector('.tab[data-view="active"].active');
    const deliveredVisible = document.querySelector(".package-card.delivered");
    if (!activeTab || !deliveredVisible) return;

    const changed = archiveDeliveredPackages();
    if (!changed) return;

    reloadScheduled = true;
    setTimeout(() => location.reload(), 250);
  }

  function watchDeliveredPackages() {
    const list = document.getElementById("packageList");
    if (!list) return;

    const observer = new MutationObserver(scheduleReloadIfNeeded);
    observer.observe(list, { childList: true, subtree: true });
    scheduleReloadIfNeeded();
  }

  const style = document.createElement("style");
  style.textContent = "@keyframes trackpack-spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(style);

  archiveDeliveredPackages();

  document.addEventListener("DOMContentLoaded", () => {
    addRefreshButton();
    watchDeliveredPackages();
  });
})();
