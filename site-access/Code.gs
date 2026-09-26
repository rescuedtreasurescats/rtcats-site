/**
 * Separate Apps Script web app for rtcats.com access. Deploy as the sheet owner.
 * Script properties (set in Apps Script project settings):
 *   SITE_SETTINGS_SPREADSHEET_ID = the portal database spreadsheet ID
 *   SITE_GATE_TOKEN = a long random token also configured as a Cloudflare secret
 *
 * The public site's existing action=settings response must never read D:E.
 */

function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents || '{}');
    var properties = PropertiesService.getScriptProperties();
    var token = properties.getProperty('SITE_GATE_TOKEN');
    var spreadsheetId = properties.getProperty('SITE_SETTINGS_SPREADSHEET_ID');
    if (!token || !spreadsheetId || !request.token ||
        !sameText_(String(request.token), token)) {
      return json_({ error: 'unauthorized' });
    }
    if (request.action !== 'status' && request.action !== 'verify') {
      return json_({ error: 'bad_request' });
    }

    var rows = SpreadsheetApp.openById(spreadsheetId)
      .getSheetByName('Settings').getRange('D2:E4').getDisplayValues();
    if (rows[0][0] !== 'SiteAccessPIN' ||
        rows[1][0] !== 'EmergencyContactName' ||
        rows[2][0] !== 'EmergencyContactPhone') {
      return json_({ error: 'settings_mismatch' });
    }
    var pin = String(rows[0][1] || '').trim();
    var required = pin.length > 0;
    var version = required ? signature_(pin, token) : 'open';
    var result = {
      required: required,
      version: version,
      emergencyName: rows[1][1],
      emergencyPhone: rows[2][1]
    };

    if (request.action === 'verify') {
      var key = 'site-' + signature_(String(request.ip || 'unknown'), token).slice(0,40);
      var cache = CacheService.getScriptCache();
      var attempts = Number(cache.get(key) || 0);
      if (attempts >= 8) return json_({ error: 'too_many_attempts' });
      var candidate = String(request.pin || '');
      result.valid = !required || sameText_(candidate, pin);
      if (result.valid) cache.remove(key);
      else cache.put(key, String(attempts + 1), 900);
    }
    return json_(result);
  } catch (error) {
    console.error(error);
    return json_({ error: 'unavailable' });
  }
}

function signature_(text, secret) {
  return Utilities.computeHmacSha256Signature(text, secret)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); })
    .join('');
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
