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
      return ['Date', 'Type', 'Category', 'Store', 'Car', 'Project', 'Amount', 'Description', 'ID', 'Raw JSON'];
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
      return [entry.date, (entry.type || '').toString().toUpperCase(), (entry.categoryName || entry.categoryId || '').toString().toUpperCase(), entry.storeName || entry.storeId, entry.carName || '', entry.projectName || '', entry.amount, entry.description || '', entry.id, JSON.stringify(entry)];
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

// One-time cleanup: run this manually from the Apps Script editor (select the function
// in the dropdown next to "Run", then click Run) if a sync race condition ever produces
// duplicate rows. It finds the "ID" column on every sheet and removes duplicate rows,
// keeping only the first occurrence of each ID. Safe to run more than once.
function removeDuplicateRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var totalRemoved = 0;

  sheets.forEach(function (sheet) {
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return; // no data rows to check

    var headers = data[0];
    var idCol = headers.indexOf('ID');
    if (idCol === -1) return; // not one of our sheets, skip it

    var seen = {};
    var rowsToDelete = [];
    for (var r = 1; r < data.length; r++) {
      var id = data[r][idCol];
      if (seen[id]) {
        rowsToDelete.push(r + 1); // +1 because sheet rows are 1-indexed and we have a header row
      } else {
        seen[id] = true;
      }
    }

    // Delete from the bottom up so row numbers don't shift as we go
    for (var i = rowsToDelete.length - 1; i >= 0; i--) {
      sheet.deleteRow(rowsToDelete[i]);
    }
    if (rowsToDelete.length > 0) {
      Logger.log(sheet.getName() + ': removed ' + rowsToDelete.length + ' duplicate row(s)');
      totalRemoved += rowsToDelete.length;
    }
  });

  Logger.log('Done. Total duplicate rows removed: ' + totalRemoved);
}
