// Homebase — Google Sheets sync endpoint
// Handles Finance, Jazz, Weight, Vehicles, and GarageCosts.
// Paste into script.google.com, bound to your Google Sheet, then deploy as a Web App.
// See README.md for step-by-step instructions.

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var sheetName = data.sheet;
  var entry = data.entry;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headersFor(sheetName));
  }

  sheet.appendRow(rowFor(sheetName, entry));

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function headersFor(sheetName) {
  switch (sheetName) {
    case 'Finance':
      return ['Date', 'Type', 'Category', 'Store', 'Amount', 'Description', 'ID', 'Raw JSON'];
    case 'Jazz':
      return ['Start Date', 'Status', 'Severity', 'Description', 'Med Given', 'Med Cost', 'Vet Visit', 'Vet Cost', 'ID', 'Raw JSON'];
    case 'Weight':
      return ['Date', 'Subject', 'Value (lbs)', 'Note', 'ID', 'Raw JSON'];
    case 'Vehicles':
      return ['Name', 'Status', 'Bought For', 'Date Bought', 'Sold For', 'Date Sold', 'ID', 'Raw JSON'];
    case 'GarageCosts':
      return ['Date', 'Vehicle ID', 'Expense Type ID', 'Repair Type ID', 'Total Cost', 'Mileage', 'Comments', 'ID', 'Raw JSON'];
    default:
      return ['Date', 'ID', 'Raw JSON'];
  }
}

function rowFor(sheetName, entry) {
  switch (sheetName) {
    case 'Finance':
      return [entry.date, entry.type, entry.categoryName || entry.categoryId, entry.storeName || entry.storeId, entry.amount, entry.description || '', entry.id, JSON.stringify(entry)];
    case 'Jazz':
      return [entry.startDate, entry.status, entry.severity, entry.description || '', entry.medGiven ? 'Yes' : 'No', entry.medCost || '', entry.vetVisit ? 'Yes' : 'No', entry.vetCost || '', entry.id, JSON.stringify(entry)];
    case 'Weight':
      return [entry.date, entry.subject, entry.value, entry.note || '', entry.id, JSON.stringify(entry)];
    case 'Vehicles':
      return [entry.name, entry.status, entry.boughtFor || '', entry.dateBought || '', entry.soldFor || '', entry.dateSold || '', entry.id, JSON.stringify(entry)];
    case 'GarageCosts':
      return [entry.date, entry.vehicleId, entry.expenseTypeId, entry.repairTypeId || '', entry.totalCost || '', entry.mileage || '', entry.comments || '', entry.id, JSON.stringify(entry)];
    default:
      return [entry.date || '', entry.id || '', JSON.stringify(entry)];
  }
}
