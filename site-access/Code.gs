/**
 * Dedicated RTCats gate web app, executed as the spreadsheet owner.
 * Script properties: SITE_SETTINGS_SPREADSHEET_ID, SITE_GATE_TOKEN.
 * Keep the existing schedule portal script and its public settings endpoint separate.
 */
function doPost(e) {
  try {
    var request = JSON.parse((e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('SITE_GATE_TOKEN');
    var spreadsheetId = props.getProperty('SITE_SETTINGS_SPREADSHEET_ID');
    if (!token || !spreadsheetId || !request.token ||
        !sameText_(String(request.token), token)) return json_({ error: 'unauthorized' });
    if (['status', 'requestCode', 'verifyCode'].indexOf(request.action) < 0) return json_({ error: 'bad_request' });

    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var settingsSheet = spreadsheet.getSheetByName('Settings');
    var rows = settingsSheet.getRange('D2:E4').getDisplayValues();
    if (rows[0][0] !== 'WebsiteAccessMode' ||
        rows[1][0] !== 'EmergencyContactName' ||
        rows[2][0] !== 'EmergencyContactPhone') return json_({ error: 'settings_mismatch' });
    var mode = String(rows[0][1] || '').trim();
    if (mode !== '' && mode !== 'Email') return json_({ error: 'invalid_access_mode' });
    var required = mode === 'Email';
    var result = {
      required: required, emergencyName: rows[1][1], emergencyPhone: rows[2][1]
    };
    if (request.action === 'status') {
      result.allowed = required && !!findVolunteer_(spreadsheet, request.email, request.volunteerId);
      return json_(result);
    }
    if (!required) return json_({ error: 'access_not_enabled' });

    var email = normalizeEmail_(request.email);
    if (!email) return json_({ valid: false });
    var cache = CacheService.getScriptCache();
    var key = 'mail-' + signature_(email, token).slice(0, 40);
    if (request.action === 'requestCode') {
      // Coarse per-IP limit in addition to one email every 60 seconds.
      var ipKey = 'ip-' + signature_(String(request.ip || 'unknown'), token).slice(0, 40);
      var ipCount = Number(cache.get(ipKey) || 0);
      if (ipCount >= 20) return json_({ sent: true });
      cache.put(ipKey, String(ipCount + 1), 3600);
      if (cache.get('cool-' + key)) return json_({ sent: true });
      cache.put('cool-' + key, '1', 60);
      if (!findVolunteer_(spreadsheet, email, '')) return json_({ sent: true });
      if (MailApp.getRemainingDailyQuota() < 1) return json_({ error: 'mail_quota' });
      // UUID randomness; 8 decimal digits and five verification attempts.
      var code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 100000000).padStart(8, '0');
      cache.put(key, JSON.stringify({ hash: signature_(email + ':' + code, token), tries: 0 }), 600);
      MailApp.sendEmail({
        to: email, subject: 'Your RTCats volunteer sign-in code',
        body: 'Your RTCats sign-in code is ' + code + '. It expires in 10 minutes. If you did not request it, you can ignore this message.'
      });
      return json_({ sent: true });
    }
    var record = cache.get(key);
    if (!record) return json_({ valid: false });
    var challenge = JSON.parse(record);
    if (challenge.tries >= 5) { cache.remove(key); return json_({ valid: false }); }
    var candidate = String(request.code || '');
    if (!/^\d{8}$/.test(candidate) ||
        !sameText_(signature_(email + ':' + candidate, token), challenge.hash)) {
      challenge.tries++;
      if (challenge.tries >= 5) cache.remove(key);
      else cache.put(key, JSON.stringify(challenge), 600);
      return json_({ valid: false });
    }
    cache.remove(key);
    var volunteer = findVolunteer_(spreadsheet, email, '');
    return volunteer ? json_({ valid: true, volunteerId: volunteer.id, email: email }) : json_({ valid: false });
  } catch (error) {
    console.error(error);
    return json_({ error: 'unavailable' });
  }
}

function findVolunteer_(spreadsheet, email, volunteerId) {
  email = normalizeEmail_(email);
  if (!email) return null;
  var sheet = spreadsheet.getSheetByName('Volunteers');
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var rows = sheet.getRange(2, 1, last - 1, 6).getDisplayValues();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[5]).trim().toLowerCase() !== 'yes') continue;
    if (volunteerId && String(row[0]).trim() !== String(volunteerId)) continue;
    if (normalizeEmail_(row[3]) === email || normalizeEmail_(row[4]) === email) {
      return { id: String(row[0]).trim() };
    }
  }
  return null;
}
function normalizeEmail_(value) {
  var email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
function signature_(value, secret) {
  return Utilities.computeHmacSha256Signature(value, secret)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}
function sameText_(a, b) {
  var mismatch = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}
function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
