(function () {
  const SETTINGS_URL = "https://script.google.com/macros/s/AKfycbxjbnFhs4Q0dUt9PGbd1z8PlRTzCwu-c6ge2ZsAj9-HqYsdcs_Sj26zql_hXSzZGG_b/exec?action=settings";
  async function getActiveNotices() {
    const settingsResponse = await fetch(SETTINGS_URL, { cache: "no-store" });
    if (!settingsResponse.ok) throw new Error("Settings unavailable");
    const settings = await settingsResponse.json();
    const portalUrl = new URL(settings.PortalDeploymentURL);
    if (portalUrl.protocol !== "https:" || portalUrl.hostname !== "script.google.com" ||
        !portalUrl.pathname.startsWith("/macros/s/") || !portalUrl.pathname.endsWith("/exec")) {
      throw new Error("Invalid portal URL");
    }
    portalUrl.searchParams.set("action", "shiftNotices");
    portalUrl.searchParams.set("_", String(Date.now()));
    const response = await fetch(portalUrl.href, { cache: "no-store" });
    if (!response.ok) throw new Error("Notices unavailable");
    const data = await response.json();
    if (!data.success || !Array.isArray(data.notices)) throw new Error("Invalid notice response");
    return data.notices;
  }
  async function showStoreButtons() {
    try {
      const notices = await getActiveNotices();
      document.querySelectorAll("[data-shift-store]").forEach(link => {
        const hasNotice = notices.some(n => n.store === link.dataset.shiftStore);
        link.classList.toggle("has-shift-notice", hasNotice);
        const label = link.querySelector(".shift-notice-tag");
        if (label) label.hidden = !hasNotice;
      });
    } catch (error) {
      console.error("Shift notices could not be loaded.", error);
    }
  }
  async function showStoreNotices(store) {
    try {
      const notices = (await getActiveNotices()).filter(n => n.store === store);
      if (!notices.length) return;
      const subtitle = document.querySelector(".storeSubtitle");
      if (!subtitle) return;
      const container = document.createElement("section");
      container.className = "shift-notices";
      container.setAttribute("aria-label", "Important shift notices");
      notices.forEach(notice => {
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
    } catch (error) {
      console.error("Shift notices could not be loaded.", error);
    }
  }
  window.RTPAShiftNotices = { showStoreButtons, showStoreNotices };
})();
