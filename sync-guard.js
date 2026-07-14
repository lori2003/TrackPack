(() => {
  "use strict";

  const API_HOST = "api.github.com";
  const REPO_PATH = "/repos/lori2003/TrackPack";
  const nativeFetch = globalThis.fetch.bind(globalThis);

  function cleanToken(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function isPlausibleToken(value) {
    const token = cleanToken(value);
    return /^(github_pat_|ghp_)[A-Za-z0-9_]+$/.test(token) && token.length >= 30;
  }

  function showMessage(message) {
    const box = document.getElementById("syncMessage");
    if (!box) return;
    box.textContent = message;
    box.classList.remove("hidden");
    box.classList.add("error");
  }

  globalThis.fetch = async (input, init = {}) => {
    const requestUrl = typeof input === "string" ? input : input?.url || "";
    let parsed;
    try {
      parsed = new URL(requestUrl, location.href);
    } catch {
      return nativeFetch(input, init);
    }

    if (parsed.hostname !== API_HOST || !parsed.pathname.startsWith(REPO_PATH)) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const authorization = headers.get("Authorization");
    if (authorization?.toLowerCase().startsWith("bearer ")) {
      const token = cleanToken(authorization.slice(7));
      headers.set("Authorization", `Bearer ${token}`);
    }

    try {
      return await nativeFetch(input, { ...init, headers, cache: init.cache || "no-store" });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("Il browser non riesce a contattare GitHub. Controlla la connessione, disattiva temporaneamente VPN o blocchi contenuti e riprova dopo aver premuto Aggiorna.");
      }
      throw error;
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("syncForm");
    const input = document.getElementById("githubTokenInput");
    if (!form || !input) return;

    const sanitizeInput = () => {
      const cleaned = cleanToken(input.value);
      if (input.value !== cleaned) input.value = cleaned;
    };

    input.addEventListener("input", sanitizeInput);
    input.addEventListener("paste", () => setTimeout(sanitizeInput, 0));

    form.addEventListener("submit", (event) => {
      sanitizeInput();
      if (isPlausibleToken(input.value)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      showMessage("Il token non sembra completo. Deve iniziare con github_pat_ oppure ghp_ e non deve contenere spazi o ritorni a capo.");
    }, true);
  });
})();
