(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const UPDATED_KEY = "trackpack.local.updatedAt";
  const RELOAD_MARKER = "trackpack.autoarchive.reload";
  const nativeGetItem = Storage.prototype.getItem;
  const nativeSetItem = Storage.prototype.setItem;

  function normalizeDelivered(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { value: raw, changed: false };
      let changed = false;
      const now = new Date().toISOString();
      const normalized = parsed.map((pkg) => {
        if (!pkg || typeof pkg !== "object") return pkg;
        if (String(pkg.status || "").toLowerCase() === "delivered" && pkg.isArchived !== true) {
          changed = true;
          return { ...pkg, isArchived: true, updatedAt: now };
        }
        return pkg;
      });
      return { value: JSON.stringify(normalized), changed };
    } catch {
      return { value: raw, changed: false };
    }
  }

  Storage.prototype.getItem = function (key) {
    const raw = nativeGetItem.call(this, key);
    if (this !== localStorage || key !== STORAGE_KEY || raw === null) return raw;
    return normalizeDelivered(raw).value;
  };

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && key === STORAGE_KEY) {
      const result = normalizeDelivered(value);
      value = result.value;
      if (result.changed) nativeSetItem.call(localStorage, UPDATED_KEY, new Date().toISOString());
    }
    return nativeSetItem.call(this, key, value);
  };

  function normalizeExisting() {
    const raw = nativeGetItem.call(localStorage, STORAGE_KEY);
    if (!raw) return false;
    const result = normalizeDelivered(raw);
    if (!result.changed) return false;
    nativeSetItem.call(localStorage, STORAGE_KEY, result.value);
    nativeSetItem.call(localStorage, UPDATED_KEY, new Date().toISOString());
    return true;
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
      normalizeExisting();

      try {
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
        }
        if ("caches" in window) {
          const names = await caches.keys();
          await Promise.all(names.map((name) => caches.delete(name)));
        }
      } catch {}

      const url = new URL(location.href);
      url.searchParams.set("v", Date.now().toString());
      location.replace(url.toString());
    });

    host.prepend(button);
  }

  function watchDeliveredCards() {
    let timer = null;
    const check = () => {
      const deliveredVisible = document.querySelector(".package-card.delivered");
      if (!deliveredVisible) return;
      normalizeExisting();
      if (sessionStorage.getItem(RELOAD_MARKER) === "1") return;
      sessionStorage.setItem(RELOAD_MARKER, "1");
      clearTimeout(timer);
      timer = setTimeout(() => location.reload(), 500);
    };

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    check();
  }

  const style = document.createElement("style");
  style.textContent = "@keyframes trackpack-spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(style);

  normalizeExisting();
  document.addEventListener("DOMContentLoaded", () => {
    addRefreshButton();
    watchDeliveredCards();
    setTimeout(() => sessionStorage.removeItem(RELOAD_MARKER), 1200);
  });
})();
