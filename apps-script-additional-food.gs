/* Add these routes near the other JSON actions inside doGet(e). */
if (e && e.parameter && e.parameter.action === "additionalFoodVolunteers") {
  return ContentService.createTextOutput(JSON.stringify(
    portalGetAdditionalFoodVolunteers(e.parameter.store)
  )).setMimeType(ContentService.MimeType.JSON);
}

if (e && e.parameter && e.parameter.action === "addAdditionalFood") {
  return ContentService.createTextOutput(JSON.stringify(
    portalAddAdditionalFood(
      e.parameter.store,
      e.parameter.volunteer,
      e.parameter.date,
      e.parameter.shift,
      e.parameter.amount,
      e.parameter.note
    )
  )).setMimeType(ContentService.MimeType.JSON);
}

function portalGetAdditionalFoodVolunteers(store) {
  const validStores = ["Brighton", "Baytowne", "Hard Rd"];
  if (validStores.indexOf(String(store || "")) < 0) {
    throw new Error("Invalid store.");
  }

  const sheet = getDatabaseSheet(CONFIG.SHEETS.VOLUNTEERS);
  const data = sheet.getDataRange().getDisplayValues();
  const headers = getHeaderMap(sheet);
  const names = data.slice(1).filter(row => {
    const active = String(getValueByHeader_(row, headers, "Active") || "").trim();
    const status = String(getValueByHeader_(row, headers, "Volunteer Status") || "");
    const storeAccess = String(getValueByHeader_(row, headers, store) || "").trim();
    return active === "Yes" && storeAccess === "Yes" && !/(^|,)\s*(Inactive|Leave)\s*(,|$)/i.test(status);
  }).map(row => String(
    getValueByHeader_(row, headers, "Display Name") ||
    getValueByHeader_(row, headers, "Name") || ""
  ).trim()).filter(Boolean);

  return {success:true, volunteers:Array.from(new Set(names)).sort()};
}

function portalAddAdditionalFood(store, volunteer, date, shift, amount, note) {
  const formSheets = {
    "Brighton":"Brighton Form Responses",
    "Baytowne":"Baytowne Form Responses",
    "Hard Rd":"Hard Rd Form Responses"
  };
  const validShifts = ["Breakfast", "Lunch", "Dinner"];
  const allowedAmounts = {
    "Baytowne":["½ can","1 can","1½ cans","2 cans","2+ cans"],
    "Brighton":["½ can","1 can","1½ cans","2 cans","2½ cans","3 cans","3½ cans","4 cans","4½ cans","5 cans"],
    "Hard Rd":["½ can","1 can","1½ cans","2 cans","2½ cans","3 cans","3½ cans","4 cans","4½ cans","5 cans","5½ cans","6 cans","6½ cans","7 cans","7½ cans","8 cans"]
  };

  store = String(store || "").trim();
  volunteer = String(volunteer || "").trim();
  date = String(date || "").trim();
  shift = String(shift || "").trim();
  amount = String(amount || "").trim();
  note = String(note || "").trim().slice(0, 250);

  if (!formSheets[store] || !volunteer || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      validShifts.indexOf(shift) < 0 || allowedAmounts[store].indexOf(amount) < 0) {
    throw new Error("Please complete every required field.");
  }

  const volunteers = portalGetAdditionalFoodVolunteers(store).volunteers;
  if (volunteers.indexOf(volunteer) < 0) throw new Error("Volunteer is not active for this store.");

  const sheet = getDatabase().getSheetByName(formSheets[store]);
  if (!sheet) throw new Error("Store feeding sheet is unavailable.");

  const row = new Array(Math.max(sheet.getLastColumn(), 23)).fill("");
  const parts = date.split("-");
  const enteredDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
  row[0] = enteredDate;            // A Timestamp / feeding date
  row[1] = volunteer;              // B Volunteer
  row[2] = shift;                  // C Shift
  row[16] = "Additional: " + amount; // Q Additional cans before leaving
  row[21] = note;                  // V Optional note
  row[22] = "Additional Food";     // W Entry source
  sheet.appendRow(row);

  return {success:true, message:"Added to Feeding History."};
}
