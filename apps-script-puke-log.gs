/* Baytowne Puke Log routes. Add these near the other JSON actions inside doGet(e). */
if (e && e.parameter && e.parameter.action === "addPukeLog") {
  return ContentService.createTextOutput(JSON.stringify(
    portalAddPukeLog(
      e.parameter.volunteer,
      e.parameter.date,
      e.parameter.shift,
      e.parameter.puke,
      e.parameter.known,
      e.parameter.horker,
      e.parameter.details
    )
  )).setMimeType(ContentService.MimeType.JSON);
}

if (e && e.parameter && e.parameter.action === "pukeHistory") {
  return ContentService.createTextOutput(JSON.stringify(
    portalGetPukeHistory(e.parameter.limit)
  )).setMimeType(ContentService.MimeType.JSON);
}

function portalAddPukeLog(volunteer, date, shift, puke, known, horker, details) {
  volunteer = String(volunteer || "").trim();
  date = String(date || "").trim();
  shift = String(shift || "").trim();
  puke = String(puke || "").trim();
  known = String(known || "").trim();
  horker = String(horker || "").trim();
  details = String(details || "").trim().slice(0, 500);

  if (!volunteer || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      ["Breakfast","Lunch","Dinner"].indexOf(shift) < 0 ||
      ["Yes","No"].indexOf(puke) < 0) {
    throw new Error("Please complete every required field.");
  }

  const volunteers = portalGetAdditionalFoodVolunteers("Baytowne").volunteers;
  if (volunteers.indexOf(volunteer) < 0) throw new Error("Volunteer is not active for Baytowne.");

  if (puke === "No") {
    known = "";
    horker = "";
    details = "";
  } else {
    if (["Yes","No"].indexOf(known) < 0) throw new Error("Please answer whether you know whodunnit.");
    if (known === "No") horker = "Unknown Horker";
    if (["Peter","Paul","Unknown Horker"].indexOf(horker) < 0) throw new Error("Please choose Peter, Paul, or Unknown Horker.");
  }

  const sheet = getDatabase().getSheetByName("Puke Log");
  if (!sheet) throw new Error("Puke Log sheet is unavailable.");

  const p = date.split("-");
  const entered = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  const weekday = Utilities.formatDate(entered, Session.getScriptTimeZone() || "America/New_York", "EEEE");
  sheet.appendRow([new Date(), entered, weekday, shift, volunteer, puke, known, horker, details, "Baytowne Puke Log"]);
  return {success:true};
}

function portalGetPukeHistory(limit) {
  const sheet = getDatabase().getSheetByName("Puke Log");
  if (!sheet) return {success:true, records:[]};
  const values = sheet.getDataRange().getValues();
  const max = Math.max(1, Math.min(Number(limit)||1000, 5000));
  const records = values.slice(1).filter(r => r[0]).map(r => ({
    timestamp: r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime(),
    date: r[1] instanceof Date ? Utilities.formatDate(r[1], "America/New_York", "M/d/yyyy") : String(r[1]||""),
    weekday: String(r[2]||""),
    shift: String(r[3]||""),
    volunteer: String(r[4]||""),
    puke: String(r[5]||""),
    known: String(r[6]||""),
    horker: String(r[7]||""),
    details: String(r[8]||"")
  })).sort((a,b)=>b.timestamp-a.timestamp).slice(0,max);
  return {success:true, records:records};
}
