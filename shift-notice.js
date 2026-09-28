// Read dated notices from the portal database through the portal web app.
// If the service is unavailable, store and Daily Form links still work.
(() => {
  const SETTINGS_URL = 'https://script.google.com/macros/s/AKfycbxjbnFhs4Q0dUt9PGbd1z8PlRTzCwu-c6ge2ZsAj9-HqYsdcs_Sj26zql_hXSzZGG_b/exec?action=settings';
  const stores = ['Baytowne', 'Hard Rd', 'Brighton'];
  const storePages = {Baytowne: 'baytowne.html', 'Hard Rd': 'hardrd.html', Brighton: 'brighton.html'};
  const storeLinks = stores.map(store => ({
    store,
    link: [...document.querySelectorAll('a.quick-button')]
      .find(link => link.getAttribute('href') === storePages[store])
  })).filter(item => item.link);
  const formLink = [...document.querySelectorAll('a.toolButton')]
    .find(link => link.textContent.includes('Daily Form'));
  const currentStore = stores.find(store => location.pathname.endsWith(storePages[store]));
  if (!storeLinks.length && !(formLink && currentStore)) return;

  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const clock = `${parts.hour}:${parts.minute}`;

  // Shift names are used for targeting; the display windows cover arrival
  // through the time a volunteer would normally finish notes.
  const windows = {
    Breakfast: ['08:00', '11:45'], Lunch: ['11:45', '15:30'],
    Dinner: ['15:30', '21:00']
  };
  const relevant = note => {
    if (!note || !note.message || !note.shift) return false;
    if (note.shift === 'All shifts') return true;
    const window = windows[note.shift];
    return !!window && clock >= window[0] && clock < window[1];
  };

  async function baseUrl() {
    if (typeof getPortalBaseUrl === 'function') return getPortalBaseUrl();
    const response = await fetch(SETTINGS_URL, {cache: 'no-store'});
    if (!response.ok) throw new Error('Settings unavailable');
    const settings = await response.json();
    return settings.PortalDeploymentURL;
  }

  function badge(link) {
    const pill = document.createElement('span');
    pill.className = 'shift-notice-badge';
    pill.textContent = 'Important Shift Note';
    link.append(pill);
    link.setAttribute('aria-label', `${link.textContent.trim()} — Important Shift Note`);
  }

  function card(note) {
    const box = document.createElement('section');
    box.className = 'shift-notice';
    const heading = document.createElement('h2');
    heading.className = 'shift-notice__heading';
    heading.textContent = `Important Shift Note · ${note.shift}`;
    const body = document.createElement('p');
    body.className = 'shift-notice__body';
    body.textContent = note.message;
    box.append(heading, body);
    if (note.actionRequired && note.confirmationLabel) {
      const detail = document.createElement('p');
      detail.className = 'shift-notice__detail';
      detail.textContent = `After doing this, note in your Daily Form: ${note.confirmationLabel}`;
      box.append(detail);
    }
    return box;
  }

  function attach(link, notes, label) {
    badge(link);
    const dialog = document.createElement('dialog');
    dialog.className = 'shift-notice-dialog';
    dialog.setAttribute('aria-label', 'Important Shift Notes');
    notes.forEach(note => dialog.append(card(note)));
    const actions = document.createElement('div');
    actions.className = 'shift-notice-dialog__actions';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back';
    back.addEventListener('click', () => dialog.close());
    const continueLink = document.createElement('a');
    continueLink.href = link.href;
    continueLink.target = link.target || '_self';
    continueLink.rel = 'noopener noreferrer';
    continueLink.textContent = `Continue to ${label}`;
    actions.append(back, continueLink);
    dialog.append(actions);
    document.body.append(dialog);
    link.addEventListener('click', event => {
      if (!dialog.showModal) return;
      event.preventDefault();
      dialog.showModal();
    });
  }

  async function load() {
    try {
      const base = await baseUrl();
      await Promise.all([...storeLinks, ...(formLink && currentStore ? [{store: currentStore, link: formLink}] : [])]
        .map(async ({store, link}) => {
          const url = new URL(base);
          url.searchParams.set('action', 'shiftNotices');
          url.searchParams.set('store', store);
          url.searchParams.set('date', date);
          const response = await fetch(url.toString(), {cache: 'no-store'});
          if (!response.ok) return;
          const result = await response.json();
          if (!result.success || !Array.isArray(result.notices)) return;
          const notes = result.notices.filter(relevant);
          if (notes.length) attach(link, notes, formLink === link ? 'Daily Form' : store);
        }));
    } catch (error) {
      // Links remain usable when notices cannot load.
    }
  }
  load();
})();
