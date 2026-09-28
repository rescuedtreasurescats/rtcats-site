// The Google Daily Form cannot render custom site notices. Keep the reminder
// visible on the store page and repeat it before opening the form.
(() => {
  const store = document.querySelector('.storeTitle')?.textContent || '';
  const form = [...document.querySelectorAll('a.toolButton')]
    .find(link => link.textContent.includes('Daily Form'));
  if (!form) return;

  const notes = [
    {
      store: 'Baytowne', date: '2026-09-30', from: '10:30', until: '15:30',
      shift: 'Wednesday lunch',
      message: 'Dinner coverage will arrive about an hour late. Please leave one extra can of food for the cats before you go.'
    }
  ];
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const clock = `${parts.hour}:${parts.minute}`;
  const note = notes.find(item => store.includes(item.store) &&
    item.date === today && clock >= item.from && clock < item.until);
  if (!note) return;

  function card() {
    const box = document.createElement('section');
    box.className = 'shift-notice';
    box.setAttribute('aria-label', 'Important Shift Note');
    const heading = document.createElement('h2');
    heading.className = 'shift-notice__heading';
    heading.textContent = `Important Shift Note · ${note.shift}`;
    const body = document.createElement('p');
    body.className = 'shift-notice__body';
    body.textContent = note.message;
    box.append(heading, body);
    return box;
  }
  form.before(card());

  const dialog = document.createElement('dialog');
  dialog.className = 'shift-notice-dialog';
  dialog.setAttribute('aria-label', 'Important Shift Note before Daily Form');
  dialog.append(card());
  const actions = document.createElement('div');
  actions.className = 'shift-notice-dialog__actions';
  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'Back to store page';
  later.addEventListener('click', () => dialog.close());
  const continueLink = document.createElement('a');
  continueLink.href = form.href;
  continueLink.target = '_blank';
  continueLink.rel = 'noopener noreferrer';
  continueLink.textContent = 'Continue to Daily Form';
  continueLink.addEventListener('click', () => dialog.close());
  actions.append(later, continueLink);
  dialog.append(actions);
  document.body.append(dialog);
  form.addEventListener('click', event => {
    if (!dialog.showModal) return;
    event.preventDefault();
    dialog.showModal();
  });
})();
