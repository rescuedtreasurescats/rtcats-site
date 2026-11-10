const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../apps-script-cleaning.gs'),'utf8');

function fixture() {
  const context = vm.createContext({console, Utilities:{formatDate:(_date,_tz,format) => format === 'yyyy-MM-dd' ? '2026-11-09' : '2026-11-09T20:00:00.000-05:00'},SpreadsheetApp:{flush() {}},LockService:{getScriptLock:() => ({tryLock:() => true,releaseLock() {}})}});
  vm.runInContext(source,context);
  const rows = [];
  const sheet = {
    getLastRow:() => rows.length+1,getMaxRows:() => 1000,
    getRange:(_row,_col,_height,_width) => ({setValues(values) { rows.push(...JSON.parse(JSON.stringify(values))); }})
  };
  const jobs = [{id:'CLN-001',title:'Wash bowls',frequency:'Daily',points:10},{id:'CLN-002',title:'Change rug',frequency:'As Needed',points:null}];
  context.cleaningWorkbook_ = () => ({});
  context.cleaningHistory_ = () => ({sheet,rows});
  context.cleaningVolunteers_ = () => [{id:'V1',name:'Jane A'},{id:'V2',name:'Sam B'}];
  context.cleaningShifts_ = () => ['Breakfast','Dinner'];
  context.cleaningJobs_ = () => jobs;
  const payload = {store:'Brighton',date:'2026-11-09',shift:'Breakfast',requestId:'request-0001',volunteerId:'V1',items:[{taskId:'CLN-001',helpers:['V2']}]};
  return {context,rows,jobs,payload};
}
test('periods reset independently by shift, day, Monday week, month and year',() => {
  const {context:c} = fixture();
  assert.equal(c.cleaningPeriod_('Each Shift','2026-11-09','Breakfast'),'2026-11-09|Breakfast');
  assert.notEqual(c.cleaningPeriod_('Each Shift','2026-11-09','Breakfast'),c.cleaningPeriod_('Each Shift','2026-11-09','Dinner'));
  assert.equal(c.cleaningPeriod_('Daily','2026-11-09','Dinner'),'2026-11-09');
  assert.equal(c.cleaningPeriod_('Weekly','2026-11-08','Dinner'),'2026-11-02');
  assert.equal(c.cleaningPeriod_('Weekly','2026-11-09','Dinner'),'2026-11-09');
  assert.equal(c.cleaningPeriod_('Weekly','2027-01-01','Dinner'),'2026-12-28');
  assert.equal(c.cleaningPeriod_('Monthly','2026-12-31','Dinner'),'2026-12');
  assert.equal(c.cleaningPeriod_('Monthly','2027-01-01','Dinner'),'2027-01');
});
test('invalid dates and future dates are rejected',() => {
  const {context:c} = fixture();
  assert.throws(() => c.cleaningDate_('2026-02-30'),/actual date/);
  assert.throws(() => c.cleaningDate_('2026-11-10'),/actual date/);
  assert.throws(() => c.cleaningDate_('11/9/26'),/valid work date/);
});
test('shared completion records both people, with one total job value',() => {
  const {context:c,rows,payload} = fixture();
  const result = c.portalSaveCleaning(payload);
  assert.equal(result.success,true); assert.equal(rows.length,2);
  assert.equal(rows[0][0],rows[1][0]);
  assert.deepEqual(rows.map(r => r[10]),['Jane A','Sam B']);
  assert.deepEqual(rows.map(r => r[13]),[5,5]);
  assert.equal(rows.reduce((sum,r) => sum+r[13],0),10);
  assert.ok(rows.every(r => r[11] === 10 && r[12] === 2 && r[15] === 'Completed'));
});
test('retry of the same request is idempotent',() => {
  const {context:c,rows,payload} = fixture();
  c.portalSaveCleaning(payload); c.portalSaveCleaning(payload);
  assert.equal(rows.length,2);
});
test('a second volunteer cannot add duplicate credit in the same store and period',() => {
  const {context:c,rows,payload} = fixture();
  c.portalSaveCleaning(payload);
  const result = c.portalSaveCleaning({...payload,requestId:'request-0002',volunteerId:'V2',items:[{taskId:'CLN-001'}]});
  assert.equal(rows.length,2); assert.equal(result.skipped.length,1);
});
test('Brighton completion never completes the same job at Hard Rd',() => {
  const {context:c,rows,payload,jobs} = fixture();
  c.portalSaveCleaning(payload);
  assert.equal(c.cleaningCompletion_(rows,jobs[0],'Hard Rd','2026-11-09','Breakfast').done,false);
  c.portalSaveCleaning({...payload,store:'Hard Rd',requestId:'request-0002'});
  assert.equal(rows.length,4);
});
test('blank point values stay unassigned; as-needed work can recur',() => {
  const {context:c,rows,payload,jobs} = fixture();
  const p = {...payload,items:[{taskId:'CLN-002'}]};
  c.portalSaveCleaning(p);
  c.portalSaveCleaning({...p,requestId:'request-0002'});
  assert.equal(rows.length,2); assert.equal(rows[0][11],''); assert.equal(rows[0][13],'');
  assert.equal(c.cleaningCompletion_(rows,jobs[1],'Brighton','2026-11-09','Breakfast').done,false);
});
test('forged helpers and duplicate participants are rejected without writing',() => {
  const {context:c,rows,payload} = fixture();
  assert.throws(() => c.portalSaveCleaning({...payload,items:[{taskId:'CLN-001',helpers:['UNKNOWN']}]}),/not active/);
  assert.throws(() => c.portalSaveCleaning({...payload,items:[{taskId:'CLN-001',helpers:['V1']}]}),/only once/);
  assert.equal(rows.length,0);
});
test('a bad item causes no partial batch save',() => {
  const {context:c,rows,payload} = fixture();
  assert.throws(() => c.portalSaveCleaning({...payload,items:[{taskId:'CLN-001'},{taskId:'REMOVED'}]}),/job changed/);
  assert.equal(rows.length,0);
});
test('issue reports receive no points and do not complete a job',() => {
  const {context:c,rows,payload,jobs} = fixture();
  c.portalSaveCleaning({...payload,mode:'issue',items:[{taskId:'CLN-001',note:'Out of supplies'}]});
  assert.equal(rows[0][15],'Needs attention'); assert.equal(rows[0][13],'');
  const result = c.cleaningCompletion_(rows,jobs[0],'Brighton','2026-11-09','Breakfast');
  assert.equal(result.done,false); assert.equal(result.issue.note,'Out of supplies');
});
test('voided records do not earn completion status',() => {
  const {context:c,rows,payload,jobs} = fixture();
  c.portalSaveCleaning(payload); rows.forEach(r => r[15] = 'Voided');
  assert.equal(c.cleaningCompletion_(rows,jobs[0],'Brighton','2026-11-09','Breakfast').done,false);
});
test('notes cannot become spreadsheet formulas',() => {
  const {context:c,rows,payload} = fixture();
  c.portalSaveCleaning({...payload,items:[{taskId:'CLN-001',note:'=IMPORTXML("bad")'}]});
  assert.equal(rows[0][14],"'=IMPORTXML(\"bad\")");
});
test('Sheets-coerced dates retain completion status and prevent duplicate credit',() => {
  const c = vm.createContext({Utilities:{formatDate:(_date,_tz,format) => format === 'yyyy-MM' ? '2026-11' : '2026-11-09'}});
  vm.runInContext(source,c);
  vm.runInContext(`
    const row = ['QA','2026-11-09T20:00:00-05:00',new Date('2026-11-09T05:00:00Z'),'Brighton','Breakfast','CLN-001','Bowls','Daily',new Date('2026-11-09T05:00:00Z'),'V1','Jane A',10,1,10,'','Completed'];
    const fakeSheet = {getDataRange:() => ({getValues:() => [CLEANING_HEADERS_,row]})};
    const history = cleaningHistory_({getSheetByName:() => fakeSheet});
    if (!cleaningCompletion_(history.rows,{id:'CLN-001',frequency:'Daily'},'Brighton','2026-11-09','Breakfast').done) throw Error('Date coercion lost completion');
  `,c);
});
