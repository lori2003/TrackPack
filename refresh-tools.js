(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const UPDATED_KEY = "trackpack.local.updatedAt";
  const TOKEN_KEY = "trackpack.github.token";
  const REFRESH_FILE = "data/refresh-request.json";
  const GITHUB_API = "https://api.github.com/repos/lori2003/TrackPack";
  let reloadScheduled = false;

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
  }

  function githubHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  function utf8ToBase64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  async function requestTrackingUpdate(retry = true) {
    const token = getToken();
    if (!token) return { ok: false, reason: "missing-token" };

    const endpoint = `${GITHUB_API}/contents/${REFRESH_FILE}`;
    const currentResponse = await fetch(`${endpoint}?ref=main&t=${Date.now()}`, {
      headers: githubHeaders(token),
      cache: "no-store"
    });

    let current = null;
    if (currentResponse.ok) current = await currentResponse.json();
    else if (currentResponse.status !== 404) throw new Error(`GitHub ${currentResponse.status}`);

    const requestedAt = new Date().toISOString();
    const body = {
      message: `Richiesta aggiornamento tracking ${requestedAt}`,
      content: utf8ToBase64(JSON.stringify({ requestedAt, source: "github-pages" }, null, 2)),
      branch: "main"
    };
    if (current?.sha) body.sha = current.sha;

    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { ...githubHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (response.status === 409 && retry) return requestTrackingUpdate(false);
    if (!response.ok) throw new Error(`GitHub ${response.status}`);

    sessionStorage.setItem("trackpack.tracking.refreshRequestedAt", requestedAt);
    return { ok: true, requestedAt };
  }

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

    archiveDeliveredPackages();

    try {
      if (label) label.textContent = "Controllo…";
      await requestTrackingUpdate();
    } catch (error) {
      console.warn("Richiesta tracking non avviata", error);
    }

    try {
      if (label) label.textContent = "Aggiorno…";
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

  globalThis.TrackPackRefresh = Object.freeze({
    requestTrackingUpdate,
    getToken,
    clearTrackPackCache
  });

  archiveDeliveredPackages();

  document.addEventListener("DOMContentLoaded", () => {
    bindRefreshButton();
    watchDeliveredPackages();
  });
})();
