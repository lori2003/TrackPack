(() => {
  "use strict";

  const STORAGE_KEY = "trackpack.packages.v3";
  const nativeSetItem = Storage.prototype.setItem;

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
      const parsed = JSON.parse(raw);
      const normalized = normalizeList(parsed);
      nativeSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(normalized));
    } catch {}
  }

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage && key === STORAGE_KEY) {
      try {
        value = JSON.stringify(normalizeList(JSON.parse(value)));
      } catch {}
    }
    return nativeSetItem.call(this, key, value);
  };

  function simplifyInterface() {
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
      card.classList.remove("in_transit", "out_for_delivery", "exception");
      if (!isDelivered) card.classList.add("pending");

      const badge = card.querySelector(".badge");
      if (badge) {
        badge.className = `badge ${isDelivered ? "delivered" : "pending"}`;
        badge.textContent = isDelivered ? "Consegnato" : "In attesa";
      }

      const progress = card.querySelector(".progress-bar");
      if (progress) progress.style.width = isDelivered ? "100%" : "25%";
    });
  }

  normalizeStoredPackages();
  const observer = new MutationObserver(simplifyInterface);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.addEventListener("DOMContentLoaded", simplifyInterface);
})();
