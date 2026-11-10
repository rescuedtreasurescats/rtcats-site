'use strict';
(() => {
  const settingsUrl = 'https://script.google.com/macros/s/AKfycbxjbnFhs4Q0dUt9PGbd1z8PlRTzCwu-c6ge2ZsAj9-HqYsdcs_Sj26zql_hXSzZGG_b/exec?action=settings';
  const store = new URLSearchParams(location.search).get('store');
  const $ = id => document.getElementById(id);
  let baseUrl = '', data = null, busy = false, loading = false, request = null;
  const groups = ['Each Shift','Daily','Weekly','Monthly','As Needed'];
  const escape = value => String(value || '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const newId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2);
  const readPreference = key => { try { return localStorage.getItem('cleaning:'+store+':'+key) || ''; } catch { return ''; } };
  const writePreference = (key,value) => { try { localStorage.setItem('cleaning:'+store+':'+key,value); } catch { /* Optional convenience only. */ } };
  const selected = () => [...document.querySelectorAll('.job-check:checked:not(:disabled)')];
  function status(message,error = false) { $('status').textContent = message; $('status').classList.toggle('error',error); }
  function updateSave() {
    const count = selected().length;
    $('selectedCount').textContent = count ? count+' job'+(count === 1 ? '' : 's')+' selected' : 'No jobs selected';
    $('save').disabled = busy || loading || !count || !$('date').value || !$('volunteer').value || !$('shift').value;
    document.querySelectorAll('.job-check').forEach(el => el.closest('.job').classList.toggle('picked',el.checked));
  }
  function displayTime(value) {
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function options(volunteers,selectedId = '') {
    return volunteers.map(v => '<option value="'+escape(v.id)+'"'+(v.id === selectedId ? ' selected' : '')+'>'+escape(v.name)+'</option>').join('');
  }
  function render() {
    const actor = $('volunteer').value, html = [];
    groups.forEach(frequency => {
      const jobs = data.jobs.filter(j => j.frequency === frequency);
      if (!jobs.length) return;
      html.push('<section aria-label="'+escape(frequency)+'"><h3>'+escape(frequency)+'</h3>');
      jobs.forEach(job => {
        const pts = job.points == null ? 'Points to be set' : job.points+' point'+(job.points === 1 ? '' : 's');
        const index = data.jobs.indexOf(job);
        html.push('<article class="card job'+(job.done ? ' done' : '')+'" data-task="'+escape(job.id)+'">'+
          '<label class="job-label"><input class="job-check" type="checkbox" data-id="'+escape(job.id)+'"'+(job.done ? ' checked disabled' : '')+' aria-label="'+escape(job.title)+'"><span class="job-content"><span class="job-heading"><span class="job-title">'+escape(job.title)+'</span><span class="points">'+escape(pts)+'</span></span>'+
          (job.instructions ? '<span class="instructions">'+escape(job.instructions)+'</span>' : '')+'</span></label>'+
          (job.last ? '<p class="completion">'+(job.frequency === 'As Needed' ? 'Last done: ' : '✓ Completed: ')+escape(job.last.names.join(' + '))+' · '+escape(displayTime(job.last.at))+'</p>' : '')+
          (job.issue ? '<p class="issue"><b>Needs attention:</b> '+escape(job.issue.note)+'<br>'+escape(job.issue.name)+' · '+escape(displayTime(job.issue.at))+'</p>' : '')+
          (!job.done ? '<details><summary>Shared job or a note?</summary><label for="helper-'+index+'">Completed together with <span style="font-weight:400">(optional)</span></label><select id="helper-'+index+'" class="helper"><option value="">I did this on my own</option>'+options(data.volunteers.filter(v => v.id !== actor))+'</select><p class="hint">A shared job’s points are split equally between both people.</p><label for="note-'+index+'">Note <span style="font-weight:400">(optional)</span></label><textarea id="note-'+index+'" class="job-note" maxlength="500" rows="2"></textarea></details>' : '')+
          '<button type="button" class="issue-button" data-issue="'+escape(job.id)+'">Report something that needs attention</button></article>');
      });
      html.push('</section>');
    });
    $('jobs').innerHTML = html.join('');
    $('empty').hidden = data.jobs.length !== 0;
    const recurring = data.jobs.filter(j => j.frequency !== 'As Needed');
    $('progress').textContent = recurring.filter(j => j.done).length+' of '+recurring.length+' recurring jobs completed for this shift / day / week / month.'+
      (!$('shift').value ? ' Choose your shift to see its checklist.' : '');
    $('jobs').querySelectorAll('.job-check').forEach(el => el.addEventListener('change',updateSave));
    $('jobs').querySelectorAll('[data-issue]').forEach(el => el.addEventListener('click',() => reportIssue(el.dataset.issue)));
    updateSave();
  }
  async function api(action,params = {},write = false) {
    if (!baseUrl) {
      const settings = await fetch(settingsUrl).then(r => r.json());
      const url = new URL(settings.PortalDeploymentURL);
      if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') throw new Error('Portal is temporarily unavailable.');
      baseUrl = url.href;
    }
    let response;
    if (write) response = await fetch(baseUrl,{method:'POST',body:new URLSearchParams({action,payload:JSON.stringify(params)})});
    else response = await fetch(baseUrl+'?'+new URLSearchParams({action,...params}),{cache:'no-store'});
    const result = await response.json();
    if (!result || !result.success) throw new Error(result && result.message || 'Could not load cleaning. Please try again.');
    return result;
  }
  async function load(quiet = false) {
    if (loading || busy || (quiet && (selected().length || document.querySelector('.job details[open]')))) return;
    if (!$('date').value) { status('Choose the date you worked.',true); return; }
    loading = true; updateSave(); $('jobs').setAttribute('aria-busy','true');
    try {
      const result = await api('cleaningList',{store,date:$('date').value,shift:$('shift').value});
      const volunteer = $('volunteer').value || readPreference('volunteer');
      const shift = $('shift').value;
      data = result;
      $('date').max = result.today;
      $('volunteer').innerHTML = '<option value="">Select your name</option>'+options(result.volunteers,volunteer);
      $('volunteer').disabled = false;
      $('shift').innerHTML = '<option value="">Select your shift</option>'+result.shifts.map(s => '<option'+(s === shift ? ' selected' : '')+'>'+escape(s)+'</option>').join('');
      $('shift').disabled = false;
      render();
    } catch (err) { status(err.message || 'Unable to load the checklist.',true); }
    finally { loading = false; $('jobs').setAttribute('aria-busy','false'); updateSave(); }
  }
  async function save(items,mode = 'complete') {
    if (busy || loading) return;
    if (!$('volunteer').value || !$('shift').value) { status('Choose your name and shift first.',true); return; }
    const payload = {store,date:$('date').value,shift:$('shift').value,volunteerId:$('volunteer').value,mode,items};
    const signature = JSON.stringify(payload);
    if (!request || request.signature !== signature) request = {signature,id:newId()};
    payload.requestId = request.id;
    busy = true; updateSave(); $('save').textContent = 'Saving…'; status('Saving your work…');
    try {
      const result = await api('saveCleaning',payload,true);
      selected().forEach(el => { el.checked = false; });
      request = null;
      busy = false;
      await load();
      status(result.message+(result.skipped.length ? ' '+result.skipped.length+' job(s) had already been completed by someone else.' : ''));
    } catch (err) { status((err.message || 'Could not confirm the save.')+' Your selections are kept; try Save again.',true); }
    finally { busy = false; $('save').textContent = 'Save completed jobs'; updateSave(); }
  }
  function reportIssue(taskId) {
    if (busy) return;
    if (selected().length) { status('Save your selected jobs before reporting an issue, so your selections are kept.',true); return; }
    if (!$('volunteer').value || !$('shift').value) { status('Choose your name and shift first.',true); return; }
    const job = data.jobs.find(j => j.id === taskId);
    const note = prompt('What needs attention for “'+job.title+'”? This records an issue, not a completed job.');
    if (note && note.trim()) save([{taskId,note:note.trim()}],'issue');
  }
  function confirmContextChange(el) {
    if (selected().length && !confirm('Changing the date or shift will clear your unsaved selections. Continue?')) {
      el.value = el.dataset.previous || ''; return;
    }
    el.dataset.previous = el.value;
    load();
  }
  $('save').addEventListener('click',() => save(selected().filter(el => !el.disabled).map(el => {
    const card = el.closest('.job');
    return {taskId:el.dataset.id,helpers:card.querySelector('.helper')?.value ? [card.querySelector('.helper').value] : [],note:card.querySelector('.job-note')?.value.trim() || ''};
  })));
  $('volunteer').addEventListener('change',() => {
    writePreference('volunteer',$('volunteer').value);
    document.querySelectorAll('.helper').forEach(el => {
      const value = el.value;
      el.innerHTML = '<option value="">I did this on my own</option>'+options(data.volunteers.filter(v => v.id !== $('volunteer').value),value);
    });
    updateSave();
  });
  ['date','shift'].forEach(id => $(id).addEventListener('change',() => confirmContextChange($(id))));
  $('refresh').addEventListener('click',() => {
    if (selected().length && !confirm('Refresh will clear your unsaved selections. Continue?')) return;
    load();
  });
  window.addEventListener('beforeunload',e => { if (selected().length && !busy) { e.preventDefault(); e.returnValue = ''; } });
  if (!['Brighton','Hard Rd'].includes(store)) {
    status('Open Cleaning from the Brighton or Hard Rd store page.',true); $('jobs').setAttribute('aria-busy','false'); $('progress').textContent = '';
    return;
  }
  $('storeHeader').textContent = store+' · Cleaning';
  document.title = store+' Cleaning · RTPA';
  $('back').href = store === 'Brighton' ? 'brighton.html' : 'hardrd.html'; $('back').textContent = '← '+store;
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  $('date').value = part('year')+'-'+part('month')+'-'+part('day'); $('date').dataset.previous = $('date').value;
  load();
  setInterval(() => { if (!document.hidden) load(true); },30000);
})();
