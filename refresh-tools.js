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

      const now = new Date().toISOString();
      let changed = false;
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
      console.warn("Archiviazione automatica non riuscita", error);
      return false;
    }
  }

  async function clearTrackPackCache() {
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
  }

  async function forceLatestVersion(button) {
    if (!button || button.disabled) return;

    button.disabled = true;
    button.classList.add("is-refreshing");
    button.setAttribute("aria-busy", "true");
    const label = button.querySelector(".refresh-label");
    if (label) label.textContent = "Aggiorno…";

    archiveDeliveredPackages();

    try {
      await clearTrackPackCache();
      const freshIndex = new URL("./index.html", location.href);
      freshIndex.searchParams.set("cache", Date.now().toString());
      await fetch(freshIndex, { cache: "reload" }).catch(() => null);
    } catch (error) {
      console.warn("Pulizia cache non completata", error);
    }

    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("version", Date.now().toString());
    location.replace(url.toString());
  }

  function bindRefreshButton() {
    const button = document.getElementById("forceRefreshButton");
    if (!button) return;
    button.addEventListener("click", () => forceLatestVersion(button));
  }

  function scheduleReloadIfNeeded() {
    if (reloadScheduled) return;

    const activeTab = document.querySelector('.tab[data-view="active"].active');
    const deliveredVisible = document.querySelector(".package-card.delivered");
    if (!activeTab || !deliveredVisible) return;
    if (!archiveDeliveredPackages()) return;

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

  archiveDeliveredPackages();

  document.addEventListener("DOMContentLoaded", () => {
    bindRefreshButton();
    watchDeliveredPackages();
  });
})();
