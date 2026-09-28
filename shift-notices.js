(function () {
  const PORTAL_URL = "https://script.google.com/macros/s/AKfycbwtxDLC3x8yzoKmpGn_ft7lEb1qj-vk6H00AXc1m2mGdwy0HTKAak5IXe_I1s_s81in/exec";
  const SETTINGS_URL = "https://script.google.com/macros/s/AKfycbxjbnFhs4Q0dUt9PGbd1z8PlRTzCwu-c6ge2ZsAj9-HqYsdcs_Sj26zql_hXSzZGG_b/exec?action=settings";
  const CACHE_KEY = "rtpa-shift-notices";
  const CACHE_AGE_MS = 24 * 60 * 60 * 1000;

  function easternNow() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date());
    const value = type => parts.find(part => part.type === type)?.value || "";
    return value("year") + "-" + value("month") + "-" + value("day") +
      " " + value("hour") + ":" + value("minute");
  }
  function cachedNotices() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.savedAt < CACHE_AGE_MS && Array.isArray(cached.notices)) {
        const now = easternNow();
        return cached.notices.filter(notice => notice.endAt && notice.endAt > now);
      }
    } catch (_) {}
    return null;
  }
  function saveNotices(notices) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), notices })); } catch (_) {}
  }
  function validPortalUrl(raw) {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "script.google.com" ||
        !url.pathname.startsWith("/macros/s/") || !url.pathname.endsWith("/exec")) {
      throw new Error("Invalid portal URL");
    }
    return url;
  }
  async function fetchNotices(rawUrl) {
    const url = validPortalUrl(rawUrl);
    url.searchParams.set("action", "shiftNotices");
    const response = await fetch(url.href, { cache: "no-store" });
    if (!response.ok) throw new Error("Notices unavailable");
    const data = await response.json();
    if (!data.success || !Array.isArray(data.notices)) throw new Error("Invalid notice response");
    return data.notices;
  }
  async function getActiveNotices() {
    try {
      const notices = await fetchNotices(PORTAL_URL);
      saveNotices(notices);
      return notices;
    } catch (firstError) {
      const response = await fetch(SETTINGS_URL, { cache: "no-store" });
      if (!response.ok) throw firstError;
      const settings = await response.json();
      const notices = await fetchNotices(settings.PortalDeploymentURL);
      saveNotices(notices);
      return notices;
    }
  }
  function renderStoreButtons(notices) {
    document.querySelectorAll("[data-shift-store]").forEach(link => {
      const hasNotice = notices.some(n => n.store === link.dataset.shiftStore);
      link.classList.toggle("has-shift-notice", hasNotice);
      const label = link.querySelector(".shift-notice-tag");
      if (label) label.hidden = !hasNotice;
    });
  }
  function renderStoreNotices(store, notices) {
    document.querySelector(".shift-notices")?.remove();
    const matching = notices.filter(n => n.store === store);
    if (!matching.length) return;
    const subtitle = document.querySelector(".storeSubtitle");
    if (!subtitle) return;
    const container = document.createElement("section");
    container.className = "shift-notices";
    container.setAttribute("aria-label", "Important shift notices");
    matching.forEach(notice => {
      const card = document.createElement("article");
      card.className = "shift-notice-card";
      const label = document.createElement("div");
      label.className = "shift-notice-label";
      label.textContent = "Important Shift Notice";
      const title = document.createElement("h2");
      title.textContent = notice.title || "Shift update";
      const context = document.createElement("p");
      context.className = "shift-notice-context";
      context.textContent = [notice.date, notice.shift].filter(Boolean).join(" · ");
      const message = document.createElement("p");
      message.textContent = notice.message || "";
      card.append(label, title, context, message);
      container.appendChild(card);
    });
    subtitle.insertAdjacentElement("afterend", container);
  }
  const freshNotices = getActiveNotices();
  async function showStoreButtons() {
    const cached = cachedNotices();
    if (cached) renderStoreButtons(cached);
    try { renderStoreButtons(await freshNotices); }
    catch (error) { console.error("Shift notices could not be loaded.", error); }
  }
  async function showStoreNotices(store) {
    const cached = cachedNotices();
    if (cached) renderStoreNotices(store, cached);
    try { renderStoreNotices(store, await freshNotices); }
    catch (error) { console.error("Shift notices could not be loaded.", error); }
  }
  window.RTPAShiftNotices = { showStoreButtons, showStoreNotices };
})();
