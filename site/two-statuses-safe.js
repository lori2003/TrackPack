(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const RENDER_MARKER_KEY = "trackpack.remote.rendered";
  const nativeSetItem = Storage.prototype.setItem;
  let scheduled = false;

  function normalizeList(value) {
    if (!Array.isArray(value)) return value;
    return value.map((pkg) => {
      if (!pkg || typeof pkg !== "object") return pkg;
      const delivered = String(pkg.status || "").toLowerCase() === "delivered";
      return {
        ...pkg,
        status: delivered ? "delivered" : "pending",
        deliveredAt: delivered ? pkg.deliveredAt : undefined
      };
    });
  }

  function normalizeStoredPackages() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      nativeSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(normalizeList(JSON.parse(raw))));
    } catch {}
  }

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && key === STORAGE_KEY) {
      try { value = JSON.stringify(normalizeList(JSON.parse(value))); } catch {}
    }
    return nativeSetItem.call(this, key, value);
  };

  function simplifyInterface() {
    scheduled = false;

    document.querySelectorAll(".filter").forEach((button) => {
      if (!["all", "pending", "delivered"].includes(button.dataset.filter)) button.remove();
    });

    const select = document.getElementById("statusSelect");
    if (select && (select.options.length !== 2 || !select.querySelector('option[value="delivered"]'))) {
      const current = select.value === "delivered" ? "delivered" : "pending";
      select.innerHTML = '<option value="pending">In attesa</option><option value="delivered">Consegnato</option>';
      select.value = current;
    }

    document.querySelectorAll(".package-card").forEach((card) => {
      const isDelivered = card.classList.contains("delivered");
      const wanted = isDelivered ? "delivered" : "pending";
      if (!card.classList.contains(wanted) || card.classList.contains("in_transit") || card.classList.contains("out_for_delivery") || card.classList.contains("exception")) {
        card.classList.remove("pending", "in_transit", "out_for_delivery", "delivered", "exception");
        card.classList.add(wanted);
      }
      const badge = card.querySelector(".badge");
      const label = isDelivered ? "Consegnato" : "In attesa";
      if (badge && (badge.textContent !== label || !badge.classList.contains(wanted))) {
        badge.className = `badge ${wanted}`;
        badge.textContent = label;
      }
      const progress = card.querySelector(".progress-bar");
      const width = isDelivered ? "100%" : "25%";
      if (progress && progress.style.width !== width) progress.style.width = width;
    });
  }

  function scheduleSimplify() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(simplifyInterface);
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }

  normalizeStoredPackages();

  const observer = new MutationObserver(scheduleSimplify);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("DOMContentLoaded", scheduleSimplify);

  window.addEventListener("trackpack:remote-loaded", () => {
    const raw = localStorage.getItem(STORAGE_KEY) || "[]";
    const marker = hashText(raw);
    if (sessionStorage.getItem(RENDER_MARKER_KEY) === marker) {
      scheduleSimplify();
      return;
    }
    sessionStorage.setItem(RENDER_MARKER_KEY, marker);
    setTimeout(() => location.reload(), 120);
  });
})();
