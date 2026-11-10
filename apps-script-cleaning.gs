/** Store cleaning: add cleaningList to doGet and delegate cleaning POSTs to cleaningPost_. */
const CLEANING_HEADERS_ = ['Completion ID','Logged At','Work Date','Store','Shift','Task ID','Job Done','Frequency','Period Key','Volunteer ID','Volunteer Name','Job Points','People Sharing','Points Earned','Notes','Status'];
const CLEANING_FREQUENCIES_ = ['Each Shift','Daily','Weekly','Monthly','As Needed'];

function cleaningStore_(store) {
  if (['Brighton','Hard Rd'].indexOf(store) < 0) throw new Error('Choose Brighton or Hard Rd.');
  return store;
}
function cleaningToday_() { return Utilities.formatDate(new Date(),'America/New_York','yyyy-MM-dd'); }
function cleaningDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Choose a valid work date.');
  const d = new Date(date+'T12:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0,10) !== date || date > cleaningToday_()) throw new Error('Use the actual date, no later than today.');
  return date;
}
function cleaningPeriod_(frequency,date,shift) {
  if (frequency === 'Each Shift') return date+'|'+shift;
  if (frequency === 'Monthly') return date.slice(0,7);
  if (frequency === 'Weekly') {
    const d = new Date(date+'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);
    return d.toISOString().slice(0,10);
  }
  return date;
}
function cleaningWorkbook_() {
  const settings = getDatabaseSheet('Settings').getDataRange().getDisplayValues();
  const row = settings.find(r => String(r[0]).trim() === 'CleaningWorkbookId');
  if (!row || !row[1]) throw new Error('Cleaning is not configured yet. Please contact a coordinator.');
  return SpreadsheetApp.openById(String(row[1]).trim());
}
function cleaningVolunteers_(store) {
  // Use the same active/store rules as the Daily Form and Additional Food name lists.
  const allowed = portalGetAdditionalFoodVolunteers(store).volunteers;
  const sheet = getDatabaseSheet(CONFIG.SHEETS.VOLUNTEERS), headers = getHeaderMap(sheet);
  const result = sheet.getDataRange().getDisplayValues().slice(1).filter(r =>
    String(getValueByHeader_(r,headers,'Active')).trim() === 'Yes' &&
    String(getValueByHeader_(r,headers,store)).trim() === 'Yes' &&
    !/(^|,)\s*(Inactive|Leave)\s*(,|$)/i.test(String(getValueByHeader_(r,headers,'Volunteer Status')))
  ).map(r => ({
    id:String(getValueByHeader_(r,headers,'Volunteer ID')||'').trim(),
    name:String(getValueByHeader_(r,headers,'Display Name')||getValueByHeader_(r,headers,'Name')||'').trim()
  })).filter(v => v.id && allowed.indexOf(v.name) >= 0);
  const seen = new Set();
  result.forEach(v => { if (seen.has(v.id)) throw new Error('Duplicate volunteer identity; please contact a coordinator.'); seen.add(v.id); });
  return result.sort((a,b) => a.name.localeCompare(b.name));
}
function cleaningShifts_(store) {
  const sheet = getDatabaseSheet('Shift Definitions'), h = getHeaderMap(sheet);
  return Array.from(new Set(sheet.getDataRange().getDisplayValues().slice(1).filter(r =>
    String(getValueByHeader_(r,h,'Store')).trim() === store &&
    /^(yes|true)$/i.test(String(getValueByHeader_(r,h,'Active')).trim())
  ).map(r => String(getValueByHeader_(r,h,'Shift Name')).trim()).filter(Boolean)));
}
function cleaningJobs_(ss,store,shift) {
  const sh = ss.getSheetByName('Job List');
  if (!sh) throw new Error('Job List is unavailable.');
  const values = sh.getDataRange().getValues(), h = values.shift() || [];
  const get = (r,n) => r[h.indexOf(n)];
  ['Task ID','Active','Order','Store','Shift','Frequency','Job','Instructions','Points'].forEach(n => {
    if (h.indexOf(n) < 0) throw new Error('Missing Job List column: '+n);
  });
  const seen = new Set();
  return values.filter(r => /^(true|yes)$/i.test(String(get(r,'Active'))) &&
    ['Both','All',store].indexOf(String(get(r,'Store')).trim()) >= 0 &&
    ['All',shift].indexOf(String(get(r,'Shift')||'All').trim()) >= 0
  ).map(r => {
    const id = String(get(r,'Task ID')||'').trim(), frequency = String(get(r,'Frequency')||'').trim();
    if (!id || seen.has(id) || CLEANING_FREQUENCIES_.indexOf(frequency) < 0) throw new Error('A job needs a unique ID and valid frequency. Please contact a coordinator.');
    seen.add(id);
    const raw = get(r,'Points'), points = raw === '' || raw == null ? null : Number(raw);
    if (points !== null && (!isFinite(points) || points < 0)) throw new Error('Invalid points for '+get(r,'Job')+'.');
    return {id,frequency,order:Number(get(r,'Order'))||0,title:String(get(r,'Job')||''),instructions:String(get(r,'Instructions')||''),points};
  }).sort((a,b) => a.order-b.order || a.title.localeCompare(b.title));
}
function cleaningHistory_(ss) {
  const sh = ss.getSheetByName('Cleaning History');
  if (!sh) throw new Error('Cleaning History is unavailable.');
  const rows = sh.getDataRange().getValues(), h = rows.shift() || [];
  if (CLEANING_HEADERS_.some((x,i) => h[i] !== x)) throw new Error('Cleaning History columns have changed. Please contact a coordinator.');
  return {sheet:sh,rows:rows.filter(r => r[0])};
}
function cleaningCompletion_(rows,job,store,date,shift) {
  const key = cleaningPeriod_(job.frequency,date,shift);
  const completed = rows.filter(r => r[3] === store && r[5] === job.id && r[15] === 'Completed');
  const relevant = completed.filter(r => job.frequency === 'As Needed' || String(r[8]) === key);
  relevant.sort((a,b) => String(b[1]).localeCompare(String(a[1])));
  const latest = relevant[0], group = latest ? relevant.filter(r => r[0] === latest[0]) : [];
  const issues = rows.filter(r => r[3] === store && r[5] === job.id && r[15] === 'Needs attention').sort((a,b) => String(b[1]).localeCompare(String(a[1])));
  const lastDone = completed.sort((a,b) => String(b[1]).localeCompare(String(a[1])))[0];
  const issue = issues[0] && (!lastDone || String(issues[0][1]) > String(lastDone[1])) ? issues[0] : null;
  return {
    done:job.frequency !== 'As Needed' && !!latest,
    last:latest ? {id:latest[0],date:String(latest[2]),at:String(latest[1]),names:group.map(r => String(r[10]))} : null,
    issue:issue ? {note:String(issue[14]),name:String(issue[10]),at:String(issue[1])} : null
  };
}
function portalGetCleaning(p) {
  const store = cleaningStore_(String(p.store||'')), date = cleaningDate_(String(p.date||cleaningToday_()));
  const shifts = cleaningShifts_(store), shift = String(p.shift||'');
  if (shift && shifts.indexOf(shift) < 0) throw new Error('Choose a current shift.');
  const ss = cleaningWorkbook_(), history = cleaningHistory_(ss);
  const jobs = cleaningJobs_(ss,store,shift || 'All').map(job => Object.assign({},job,cleaningCompletion_(history.rows,job,store,date,shift)));
  return {success:true,store,date,today:cleaningToday_(),shifts,volunteers:cleaningVolunteers_(store),jobs,weekStarts:'Monday'};
}
function cleaningSafeCell_(v) { return typeof v === 'string' && /^[=+@-]/.test(v) ? "'"+v : v; }
function portalSaveCleaning(p) {
  const store = cleaningStore_(String(p.store||'')), date = cleaningDate_(String(p.date||'')), shift = String(p.shift||'');
  if (cleaningShifts_(store).indexOf(shift) < 0) throw new Error('Choose your shift.');
  const request = String(p.requestId||'');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(request)) throw new Error('Please reload the checklist and try again.');
  const actorId = String(p.volunteerId||''), volunteers = cleaningVolunteers_(store);
  const actor = volunteers.find(v => v.id === actorId);
  if (!actor) throw new Error('Choose your name from the current volunteer list.');
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 100) throw new Error('Select the jobs you completed.');
  const mode = p.mode === 'issue' ? 'issue' : 'complete';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Another update is being saved. Please try again.');
  try {
    const ss = cleaningWorkbook_(), history = cleaningHistory_(ss), jobs = cleaningJobs_(ss,store,shift);
    const now = Utilities.formatDate(new Date(),'America/New_York',"yyyy-MM-dd'T'HH:mm:ss.SSSXXX"), rows = [], saved = [], skipped = [];
    const seen = new Set();
    p.items.forEach(item => {
      const job = jobs.find(j => j.id === String(item.taskId));
      if (!job || seen.has(job.id)) throw new Error('A selected job changed. Refresh before saving.');
      seen.add(job.id);
      const completionId = 'CLEAN-'+request+'-'+job.id;
      if (history.rows.some(r => r[0] === completionId)) { saved.push(job.id); return; }
      const note = String(item.note||'').trim().slice(0,500);
      if (mode === 'issue' && !note) throw new Error('Please describe what needs attention.');
      if (mode === 'complete' && cleaningCompletion_(history.rows,job,store,date,shift).done) { skipped.push(job.id); return; }
      const ids = mode === 'issue' ? [actorId] : [actorId].concat(Array.isArray(item.helpers) ? item.helpers.map(String) : []);
      if (ids.length > 6 || new Set(ids).size !== ids.length) throw new Error('Choose each helper only once.');
      const people = ids.map(id => { const person = volunteers.find(v => v.id === id); if (!person) throw new Error('A helper is not active for this store.'); return person; });
      people.forEach(person => rows.push([
        completionId,now,date,store,shift,job.id,job.title,job.frequency,cleaningPeriod_(job.frequency,date,shift),
        person.id,person.name,mode === 'complete' && job.points !== null ? job.points : '',people.length,
        mode === 'complete' && job.points !== null ? job.points/people.length : '',note,mode === 'issue' ? 'Needs attention' : 'Completed'
      ].map(cleaningSafeCell_)));
      saved.push(job.id);
    });
    if (rows.length) {
      const start = history.sheet.getLastRow()+1;
      if (start+rows.length-1 > history.sheet.getMaxRows()) history.sheet.insertRowsAfter(history.sheet.getMaxRows(),Math.max(100,rows.length));
      history.sheet.getRange(start,1,rows.length,CLEANING_HEADERS_.length).setValues(rows);
      SpreadsheetApp.flush();
    }
    return {success:true,saved,skipped,message:mode === 'issue' ? 'Issue saved for the next volunteer.' : (rows.length ? 'Your completed jobs are saved.' : 'These jobs were already saved. No duplicate credit was added.')};
  } finally { lock.releaseLock(); }
}
function cleaningPost_(e) {
  try {
    const p = JSON.parse(String(e.parameter.payload||'{}'));
    if (e.parameter.action !== 'saveCleaning') throw new Error('Unknown cleaning action.');
    return ContentService.createTextOutput(JSON.stringify(portalSaveCleaning(p))).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success:false,message:String(err.message||err)})).setMimeType(ContentService.MimeType.JSON);
  }
}
function doPost(e) { return cleaningPost_(e); }
function CHECK_CLEANING_SETUP() {
  const results = ['Brighton','Hard Rd'].map(store => {
    const r = portalGetCleaning({store});
    return {store,jobs:r.jobs.length,volunteers:r.volunteers.length,shifts:r.shifts.length,date:r.date};
  });
  console.log(JSON.stringify(results));
  return results;
}
