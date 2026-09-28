/**
 * Add this file to the existing portal Apps Script project. In its doGet(e),
 * route action=shiftNotices to shiftNoticesApi_(e) before serving Portal.html.
 * It uses the existing getDatabase() helper and the Shift Notices tab.
 *
 * Example route:
 *   if (e && e.parameter && e.parameter.action === 'shiftNotices') {
 *     return shiftNoticesApi_(e);
 *   }
 */
function shiftNoticesApi_(e) {
  var store = String(e && e.parameter && e.parameter.store || '').trim();
  var requestedDate = String(e && e.parameter && e.parameter.date || '').trim();
  var today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var allowed = {'Baytowne': true, 'Hard Rd': true, 'Brighton': true};
  var output = {success: true, notices: []};
  if (!allowed[store] || requestedDate !== today) return shiftNoticesJson_(output);

  var sheet = getDatabase().getSheetByName('Shift Notices');
  if (!sheet || sheet.getLastRow() < 2) return shiftNoticesJson_(output);
  var range = sheet.getRange(1, 1, sheet.getLastRow(), 8);
  var values = range.getDisplayValues();
  var rawDates = range.getValues().map(function (row) { return row[1]; });
  var headers = values.shift();
  rawDates.shift();
  var expected = ['Active', 'Date', 'Store', 'Shift', 'Title', 'Message',
    'Action Required', 'Confirmation Label'];
  if (expected.some(function (name, i) { return headers[i] !== name; })) {
    return shiftNoticesJson_({success: false, notices: []});
  }
  values.forEach(function (row, index) {
    var dateValue = rawDates[index];
    var rowDate = dateValue instanceof Date
      ? Utilities.formatDate(dateValue, 'America/New_York', 'yyyy-MM-dd')
      : String(dateValue).trim();
    if (row[0].trim().toLowerCase() !== 'yes' || rowDate !== today ||
        row[2].trim() !== store || !row[5].trim()) return;
    var shift = row[3].trim();
    if (['Breakfast', 'Lunch', 'Dinner', 'All shifts'].indexOf(shift) < 0) return;
    output.notices.push({
      shift: shift,
      title: row[4].trim(),
      message: row[5].trim(),
      actionRequired: row[6].trim().toLowerCase() === 'yes',
      confirmationLabel: row[7].trim()
    });
  });
  return shiftNoticesJson_(output);
}

function shiftNoticesJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
