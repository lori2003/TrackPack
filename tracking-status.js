(() => {
  "use strict";

  const RESULTS_URL = "https://raw.githubusercontent.com/lori2003/TrackPack/main/data/tracking-results.json";
  const STORAGE_KEY = "trackpack.packages.v3";
  const UPDATED_KEY = "trackpack.local.updatedAt";
  const PROGRESS = {
    label_created: 15,
    in_transit: 50,
    out_for_delivery: 80,
    delivered: 100,
    exception: 60,
    unknown: 25
  };

  function normalize(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  async function resultKey(carrier, code) {
    const data = new TextEncoder().encode(`${normalize(carrier)}:${normalize(code).replace(/\s+/g, "")}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function formatCheckedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function cardIdentity(card) {
    const row = card.querySelector(".meta .meta-row");
    const code = row?.querySelector(".mono")?.textContent?.trim();
    const spans = row ? [...row.querySelectorAll("span")] : [];
    const carrier = spans.at(-1)?.textContent?.replace(/^\s*·\s*/, "").trim();
    return code && carrier ? { code, carrier } : null;
  }

  function markDeliveredLocally(id, deliveredAt) {
    try {
      const packages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(packages)) return false;
      let changed = false;
      const now = new Date().toISOString();
      const updated = packages.map((pkg) => {
        if (pkg?.id !== id || pkg.status === "delivered") return pkg;
        changed = true;
        return {
          ...pkg,
          status: "delivered",
          deliveredAt: deliveredAt || now,
          isArchived: true,
          updatedAt: now
        };
      });
      if (!changed) return false;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(UPDATED_KEY, now);
      return true;
    } catch {
      return false;
    }
  }

  function decorateCard(card, result) {
    if (!result) return;

    const state = result.state || "unknown";
    card.dataset.trackingState = state;

    const badge = card.querySelector(".badge");
    if (badge && result.label) badge.textContent = result.label;

    const bar = card.querySelector(".progress-bar");
    if (bar) bar.style.width = `${PROGRESS[state] ?? 25}%`;

    const meta = card.querySelector(".meta");
    if (!meta) return;

    meta.querySelector(".tracking-result-row")?.remove();
    const row = document.createElement("div");
    row.className = "meta-row tracking-result-row";
    const checked = formatCheckedAt(result.checkedAt);
    row.innerHTML = `<span aria-hidden="true">↻</span><span><strong>${result.label || "Stato non determinato"}</strong>${result.message ? ` · ${result.message}` : ""}${checked ? ` · ${checked}` : ""}</span>`;
    meta.appendChild(row);

    if (state === "delivered" && markDeliveredLocally(card.dataset.id, result.checkedAt)) {
      setTimeout(() => location.reload(), 300);
    }
  }

  async function loadResults() {
    try {
      const response = await fetch(`${RESULTS_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return {};
      const payload = await response.json();
      return payload?.results || {};
    } catch {
      return {};
    }
  }

  async function applyResults() {
    if (!crypto?.subtle) return;
    const results = await loadResults();
    const cards = [...document.querySelectorAll(".package-card[data-id]")];

    await Promise.all(cards.map(async (card) => {
      const identity = cardIdentity(card);
      if (!identity) return;
      const key = await resultKey(identity.carrier, identity.code);
      decorateCard(card, results[key]);
    }));
  }

  let timer = null;
  function scheduleApply() {
    clearTimeout(timer);
    timer = setTimeout(applyResults, 120);
  }

  document.addEventListener("DOMContentLoaded", () => {
    scheduleApply();
    const list = document.getElementById("packageList");
    if (list) new MutationObserver(scheduleApply).observe(list, { childList: true, subtree: true });
  });
})();
