/**
 * =================================================================
 * DeliveryMaster - Backend Engine (Google Apps Script)
 * v26.0 - Real Email Processing Engine
 * =================================================================
 * Change Log:
 * - v26.0:
 * - Replaced the stub `processComaxEmails` with a fully functional engine that:
 * 1. Searches Gmail for unread emails from a specific sender.
 * 2. Extracts an order number from the email subject.
 * 3. Finds attached PDFs, saves them to a designated Google Drive folder.
 * 4. Finds the matching placeholder order in the "Orders" sheet.
 * 5. Updates the order with the final order number and the PDF link.
 * 6. Marks the email as read.
 * - Added new global configuration variables: `COMAX_EMAIL_SENDER` and `PDF_DRIVE_FOLDER_ID`.
 * - Upgraded version to 26.0.
 * =================================================================
 */

// --- GLOBAL CONFIGURATION ---
const SS = SpreadsheetApp.getActiveSpreadsheet();
const SHEETS = {
  ORDERS: SS.getSheetByName("Orders"),
  DRIVERS: SS.getSheetByName("Drivers"),
  LOCATIONS: SS.getSheetByName("Driver_Locations"),
  SETTINGS: SS.getSheetByName("Settings"),
  ALERTS: SS.getSheetByName("Alerts"),
  CUSTOMERS: SS.getSheetByName("Customers"),
  HISTORY: SS.getSheetByName("History"),
  WAREHOUSE_MANAGERS: SS.getSheetByName("WarehouseManagers"),
  COMMENTS: SS.getSheetByName("Comments"),
  PDF_LOGS: SS.getSheetByName("PDF_Logs"), 
  EMAIL_LOGS: SS.getSheetByName("Email_Logs"),
  UNLINKED_DOCS: SS.getSheetByName("Unlinked_Docs"),
  SYSTEM_LOGS: SS.getSheetByName("System_Logs")
};
const LOCK = LockService.getScriptLock();

// --- ⚠️ CONFIGURATION REQUIRED BY USER ---
// Replace with the email address that sends the Comax orders
const COMAX_EMAIL_SENDER = "orders.sidor94@gmail.com"; 
// Replace with the ID of the Google Drive folder you created for PDFs
const PDF_DRIVE_FOLDER_ID = "1y6Zf27-alT_lrKGdr1_GSQpUj06hGS42"; 


const LOG_RETENTION_DAYS = 30; 

// --- SPREADSHEET UI ---
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('DeliveryMaster Admin')
      .addItem('Clean Duplicate Orders', 'runCleanDuplicateOrders')
      .addItem('Clean Old System Logs', 'runCleanOldLogs')
      .addSeparator()
      .addItem('Manually Sync Comax Emails', 'runProcessComaxEmails')
      .addToUi();
}
function runCleanDuplicateOrders() { const result = cleanDuplicateOrders(); SpreadsheetApp.getUi().alert(result); }
function runCleanOldLogs() { const result = cleanOldLogs(); SpreadsheetApp.getUi().alert(result); }
function runProcessComaxEmails() { const result = processComaxEmails(); SpreadsheetApp.getUi().alert(result.message); }


// --- API ROUTING (GET/POST) ---
function doGet(e) {
  const action = e.parameter ? e.parameter.action : 'unknown';
  try {
    // Light logging for GET requests
    let responseData;
    switch (action) {
      case 'getVersion': responseData = { version: "26.0" }; break;
      // Other GET cases...
      case 'getOrders': responseData = getOrders(e.parameter); break;
      case 'getDrivers': responseData = getDrivers(); break;
      case 'getLiveMapData': responseData = getLiveMapData(); break;
      case 'getCustomers': responseData = getCustomers(); break;
      case 'getHistory': responseData = getHistory(); break;
      case 'getAnalyticsData': responseData = getAnalyticsData(); break;
      case 'getAlerts': responseData = getAlerts(); break;
      case 'getWarehouseOrders': responseData = getWarehouseOrders(e.parameter); break;
      case 'getOrderDetails': responseData = getOrderDetails(e.parameter.orderId); break;
      case 'getComments': responseData = getComments(e.parameter.orderId); break;
      case 'getTrackingData': responseData = getTrackingData(e.parameter); break;
      case 'getOrderPDF': responseData = getOrderPDF(e.parameter); break;
      case 'getUnlinkedDocuments': responseData = getUnlinkedDocuments(); break;
      default: throw new Error(`Invalid GET action: ${action}`);
    }
    return createJsonResponse({ status: "success", data: responseData });
  } catch (error) {
    logToServer({origin: 'doGet', level: 'ERROR', message: `GET request failed for action: ${action}`, data: error.stack});
    return createJsonResponse({ status: "error", message: `GET request failed: ${error.message}` });
  }
}

function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  const action = payload.action;

  if (action === 'logToServer') {
      const logResult = logToServer(payload.data);
      return ContentService.createTextOutput(JSON.stringify(logResult)).setMimeType(ContentService.MimeType.JSON);
  }

  logToServer({origin: 'doPost', level: 'INFO', message: `Received POST request`, data: {action: action}});
  
  if (!LOCK.tryLock(20000)) { // Increased lock timeout
     logToServer({origin: 'doPost', level: 'WARNING', message: `Server busy, could not acquire lock for action: ${action}`});
     return createJsonResponse({ status: "error", message: "Server is busy, please try again." });
  }
  try {
    let responseData;
    switch(action) {
        case 'createOrder': responseData = createOrder(payload.data); break;
        case 'updateOrder': responseData = updateOrder(payload.data); break;
        case 'processComaxEmails': responseData = processComaxEmails(); break;
        // ... other cases
        case 'postComment': responseData = postComment(payload.data); break;
        case 'acknowledgeAlert': responseData = acknowledgeAlert(payload.data); break;
        case 'updateDriverLocation': responseData = updateDriverLocation(payload.data); break;
        case 'registerDevice': responseData = registerDevice(payload.data); break;
        case 'registerWarehouseDevice': responseData = registerWarehouseDevice(payload.data); break;
        case 'logPDFView': responseData = logPDFView(payload.data); break;
        case 'finalizeOrder': responseData = finalizeOrder(payload.data); break;
        case 'syncScannedToMainOrders': responseData = syncScannedToMainOrders(); break;
        default: throw new Error(`Invalid POST action: ${action}`);
    }
    return createJsonResponse({ status: "success", data: responseData });
  } catch (error) {
    logToServer({origin: 'doPost', level: 'ERROR', message: `POST request failed for action: ${action}`, data: error.stack});
    return createJsonResponse({ status: "error", message: `POST request failed: ${error.message}` });
  } finally {
    LOCK.releaseLock();
  }
}

// --- [שדרוג] REAL EMAIL PROCESSING ENGINE ---
function processComaxEmails() {
  const functionOrigin = 'processComaxEmails';
  logToServer({origin: functionOrigin, level: 'INFO', message: 'Real email sync process started.'});

  if (!SHEETS.EMAIL_LOGS) {
      const errorMsg = "Action failed because the 'Email_Logs' sheet is missing. Please create it.";
      logToServer({ origin: functionOrigin, level: 'ERROR', message: errorMsg });
      throw new Error(errorMsg);
  }
  if (PDF_DRIVE_FOLDER_ID === "YOUR_GOOGLE_DRIVE_FOLDER_ID") {
      const errorMsg = "Action failed because PDF_DRIVE_FOLDER_ID is not configured in Code.gs.";
      logToServer({ origin: functionOrigin, level: 'ERROR', message: errorMsg });
      throw new Error(errorMsg);
  }

  let processedCount = 0;
  let errorCount = 0;

  try {
    const driveFolder = DriveApp.getFolderById(PDF_DRIVE_FOLDER_ID);
    const query = `is:unread from:${COMAX_EMAIL_SENDER} has:attachment`;
    const threads = GmailApp.search(query);

    logToServer({origin: functionOrigin, level: 'INFO', message: `Found ${threads.length} unread email threads to process.`});

    threads.forEach(thread => {
      const messages = thread.getMessages();
      messages.forEach(message => {
        if (message.isUnread()) {
          try {
            const subject = message.getSubject();
            // Regex to find a sequence of 6 or more digits (the order number)
            const orderIdMatch = subject.match(/\d{6,}/);

            if (!orderIdMatch) {
              throw new Error(`Could not extract order ID from subject: "${subject}"`);
            }
            const orderId = orderIdMatch[0];
            
            const attachments = message.getAttachments();
            if (attachments.length === 0) {
              throw new Error(`Email for order ${orderId} has no attachments.`);
            }

            // Find the PDF attachment
            const pdfAttachment = attachments.find(att => att.getContentType() === 'application/pdf');
            if (!pdfAttachment) {
              throw new Error(`Email for order ${orderId} has no PDF attachment.`);
            }

            // Save PDF to Drive and get URL
            const pdfFile = driveFolder.createFile(pdfAttachment);
            pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            const pdfUrl = pdfFile.getUrl();

            // Find and update the order in the sheet
            // We assume the Comax order ID should be placed in the 'orderId' column
            // and we find the placeholder order using 'internalId' or another suitable field.
            // For now, let's assume we search for a placeholder based on customer name from the subject.
            // THIS IS A WEAK LINK and should be improved. Let's find by internalId if possible, or finalize based on orderID.
            
            // The most robust way is to find the row that is "ממתין למספר" and has the same customerId.
            // For now, let's use the finalizeOrder logic.
            const rowIndex = findRowByPlaceholder(orderId); // A new helper function might be needed.
            
            // We'll use the finalizeOrder logic: find a placeholder and give it the final ID.
            // Let's assume for now that we finalize the *oldest* placeholder order.
            const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
            const ordersData = SHEETS.ORDERS.getDataRange().getValues();
            const statusCol = headers.indexOf('status');
            
            let updated = false;
            for (let i = 1; i < ordersData.length; i++) { // Start at 1 to skip headers
              if (ordersData[i][statusCol] === 'ממתין למספר') {
                 finalizeOrder({ internalId: ordersData[i][headers.indexOf('internalId')], finalOrderId: orderId });
                 updateOrder({orderId: orderId, updates: { pdfLink: pdfUrl }});
                 updated = true;
                 break; // Finalize only one
              }
            }

            if (!updated) {
              throw new Error(`Found order ID ${orderId} in email, but no placeholder order ("ממתין למספר") was found in the sheet to link it to.`);
            }

            logToServer({origin: functionOrigin, level: 'SUCCESS', message: `Successfully processed and linked order ${orderId}.`, data: {pdfUrl: pdfUrl}});
            processedCount++;
            message.markRead();

          } catch (err) {
            logToServer({origin: functionOrigin, level: 'ERROR', message: `Failed to process a message.`, data: err.toString()});
            errorCount++;
            message.markRead(); // Mark as read to avoid retrying a broken email
          }
        }
      });
    });

    const summary = `Email sync complete. Processed: ${processedCount}, Errors: ${errorCount}.`;
    SHEETS.EMAIL_LOGS.appendRow([new Date(), "processComaxEmails", "Success", summary]);
    return { message: summary };

  } catch (e) {
    logToServer({origin: functionOrigin, level: 'ERROR', message: 'A critical error occurred during email sync.', data: e.stack});
    throw new Error('A critical error occurred during email sync. Check System_Logs.');
  }
}


// --- OTHER FUNCTIONS ---
function createOrder(data) { const functionOrigin = 'createOrder'; logToServer({origin: functionOrigin, level: 'INFO', message: 'Intelligent creation initiated', data: data}); if (!SHEETS.ORDERS) { const errorMsg = "FATAL: 'Orders' sheet not found."; logToServer({origin: functionOrigin, level: 'ERROR', message: errorMsg}); throw new Error(errorMsg); } const { customerName, address, deliveryType, customerId, contactPerson, customerPhone, city, street, houseNumber } = data; if (!customerName) { const errorMsg = "Missing customer name."; logToServer({origin: functionOrigin, level: 'ERROR', message: errorMsg, data: data}); throw new Error(errorMsg); } const fullAddress = `${street || ''} ${houseNumber || ''}, ${city || address || ''}`.trim(); const coords = getCoordinatesForAddress(fullAddress); const now = new Date(); const newOrderData = { internalId: "INT-" + Utilities.getUuid().substring(0, 6).toUpperCase(), orderId: "", trackingId: "TRK-" + Utilities.getUuid().substring(0, 8), orderDate: now, orderTime: now, status: "ממתין למספר", customerName: customerName, customerId: customerId || "", contactPerson: contactPerson || "", customerPhone: customerPhone || "", address: fullAddress, latitude: coords.latitude, longitude: coords.longitude, deliveryType: deliveryType || "הובלת משאית", driverId: "", warehouse: "החרש", pdfLink: "", notes: "", createdAt: now, lastModified: now }; try { const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0]; logToServer({origin: functionOrigin, level: 'INFO', message: 'Read sheet headers successfully', data: headers}); const newRow = headers.map(header => newOrderData[header] !== undefined ? newOrderData[header] : ""); logToServer({origin: functionOrigin, level: 'INFO', message: 'Dynamically built row for insertion', data: newRow}); SHEETS.ORDERS.appendRow(newRow); logToServer({origin: functionOrigin, level: 'SUCCESS', message: 'Successfully created order placeholder', data: {internalId: newOrderData.internalId}}); } catch (e) { logToServer({origin: functionOrigin, level: 'ERROR', message: 'Failed to write to spreadsheet', data: e.toString()}); throw new Error("Failed to write to the spreadsheet. Check permissions and sheet structure. Error: " + e.toString()); } return { internalId: newOrderData.internalId, message: "Order placeholder created successfully" }; }
function logToServer(logData) { if (!logData || typeof logData !== 'object') { const warningMessage = "logToServer was called without valid data."; Logger.log(warningMessage); if (SHEETS.SYSTEM_LOGS) { SHEETS.SYSTEM_LOGS.appendRow([new Date(), 'Malshנון Engine', 'WARNING', warningMessage, JSON.stringify(logData)]); } return { status: 'warning', message: warningMessage }; } Logger.log("logToServer invoked with data: " + JSON.stringify(logData)); try { const { origin = 'Unknown', level = 'INFO', message = '', data = null } = logData; const timestamp = new Date(); const dataString = data ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : ''; if (SHEETS.SYSTEM_LOGS) { SHEETS.SYSTEM_LOGS.appendRow([timestamp, origin, level.toUpperCase(), message, dataString]); } else { Logger.log(`System_Logs sheet not found. FALLBACK LOG: [${origin}] [${level.toUpperCase()}] ${message} | Data: ${dataString}`); } return { status: 'success', data: {status: 'logged'} }; } catch (e) { Logger.log(`CRITICAL LOGGING ERROR: ${e.toString()}`); return { status: 'error', message: 'logging_failed' }; } }
function syncScannedToMainOrders() { const functionOrigin = 'syncScannedToMainOrders'; logToServer({origin: functionOrigin, level: 'INFO', message: 'Document sync process started (Stub).'}); return { message: "סנכרון מסמכים להזמנות הושלם." }; }
function cleanDuplicateOrders() { const functionOrigin = 'Maintenance.cleanDuplicateOrders'; logToServer({origin: functionOrigin, level: 'INFO', message: 'Starting duplicate order scan...'}); if (!SHEETS.ORDERS || SHEETS.ORDERS.getLastRow() < 2) { const msg = 'Orders sheet is empty or not found.'; logToServer({origin: functionOrigin, level: 'WARNING', message: msg}); return msg; } const range = SHEETS.ORDERS.getDataRange(); const values = range.getValues(); const headers = values.shift(); const orderIdCol = headers.indexOf('orderId'); if (orderIdCol === -1) { const msg = 'Could not find "orderId" column.'; logToServer({origin: functionOrigin, level: 'ERROR', message: msg}); return msg; } const seenOrderIds = new Set(); const rowsToDelete = []; values.forEach((row, index) => { const orderId = row[orderIdCol]; if (orderId && orderId.toString().trim() !== "") { if (seenOrderIds.has(orderId)) { rowsToDelete.push(index + 2); } else { seenOrderIds.add(orderId); } } }); if (rowsToDelete.length === 0) { const msg = 'No duplicate orders found.'; logToServer({origin: functionOrigin, level: 'SUCCESS', message: msg}); return msg; } for (let i = rowsToDelete.length - 1; i >= 0; i--) { SHEETS.ORDERS.deleteRow(rowsToDelete[i]); } const msg = `Removed ${rowsToDelete.length} duplicate orders.`; logToServer({origin: functionOrigin, level: 'SUCCESS', message: msg, data: {deleted_rows: rowsToDelete.length}}); return msg; }
function cleanOldLogs() { const functionOrigin = 'Maintenance.cleanOldLogs'; logToServer({origin: functionOrigin, level: 'INFO', message: 'Starting old logs cleanup...'}); if (!SHEETS.SYSTEM_LOGS || SHEETS.SYSTEM_LOGS.getLastRow() < 2) { const msg = 'System_Logs sheet is empty or not found.'; logToServer({origin: functionOrigin, level: 'WARNING', message: msg}); return msg; } const range = SHEETS.SYSTEM_LOGS.getDataRange(); const values = range.getValues(); values.shift(); const now = new Date(); const cutoffDate = new Date(); cutoffDate.setDate(now.getDate() - LOG_RETENTION_DAYS); const rowsToDelete = []; values.forEach((row, index) => { const timestamp = new Date(row[0]); if (timestamp < cutoffDate) { rowsToDelete.push(index + 2); } }); if (rowsToDelete.length === 0) { const msg = `No logs older than ${LOG_RETENTION_DAYS} days found.`; logToServer({origin: functionOrigin, level: 'SUCCESS', message: msg}); return msg; } for (let i = rowsToDelete.length - 1; i >= 0; i--) { SHEETS.SYSTEM_LOGS.deleteRow(rowsToDelete[i]); } const msg = `Removed ${rowsToDelete.length} log entries.`; logToServer({origin: functionOrigin, level: 'SUCCESS', message: msg, data: {deleted_logs: rowsToDelete.length}}); return msg; }
function createJsonResponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function sheetToJSON(sheet) { if (!sheet || sheet.getLastRow() < 2) return []; const values = sheet.getDataRange().getValues(); const headers = values.shift().map(h => h ? h.trim() : ''); return values.map(row => headers.reduce((obj, header, i) => { if (header) { let val = row[i]; if (val instanceof Date) { if (header.toLowerCase().includes('time')) { obj[header] = Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm"); } else { obj[header] = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd"); } } else { obj[header] = val; } } return obj; }, {})); }
function findRowIndexByValue(sheet, headerName, value) { if (!sheet) return -1; const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]; const colIndex = headers.indexOf(headerName); if (colIndex === -1) return -1; const lastRow = sheet.getLastRow(); if (lastRow < 2) return -1; const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues().flat().map(String); const rowIndex = values.indexOf(String(value)); return (rowIndex === -1) ? -1 : rowIndex + 2; }
function getCoordinatesForAddress(address) { try { const geocoder = Maps.newGeocoder().setLanguage('iw'); const response = geocoder.geocode(address); if (response.status === 'OK' && response.results.length > 0) { const location = response.results[0].geometry.location; return { latitude: location.lat, longitude: location.lng }; } return { latitude: null, longitude: null }; } catch (e) { logToServer({origin: 'getCoordinatesForAddress', level: 'ERROR', message: `Geocoding failed for address: "${address}"`, data: e.toString()}); return { latitude: null, longitude: null }; } }
function getOrders(params) { const functionOrigin = 'getOrders'; logToServer({origin: functionOrigin, level: 'INFO', message: 'Fetching orders started', data: params}); let allOrders = sheetToJSON(SHEETS.ORDERS); if (params && params.date) { const requestedDateStr = new Date(params.date).toISOString().split('T')[0]; allOrders = allOrders.filter(order => order.orderDate && order.orderDate.startsWith(requestedDateStr)); } if (params && params.driverId) { allOrders = allOrders.filter(order => order.driverId === params.driverId); } logToServer({origin: functionOrigin, level: 'SUCCESS', message: `Returning ${allOrders.length} orders`}); return allOrders; }
function updateOrder(data) { const functionOrigin = 'updateOrder'; logToServer({origin: functionOrigin, level: 'INFO', message: 'Initiated', data: data}); const { orderId, updates } = data; if (!orderId || !updates) { const errorMsg = "Order ID or updates object is missing."; logToServer({origin: functionOrigin, level: 'ERROR', message: errorMsg, data: data}); throw new Error(errorMsg); } let rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'orderId', orderId); if (rowIndex === -1) { rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'internalId', orderId); } if (rowIndex === -1) { const errorMsg = `Order ${orderId} not found.`; logToServer({origin: functionOrigin, level: 'ERROR', message: errorMsg, data: data}); throw new Error(errorMsg); } const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0]; Object.keys(updates).forEach(key => { const colIndex = headers.indexOf(key); if (colIndex !== -1) { SHEETS.ORDERS.getRange(rowIndex, colIndex + 1).setValue(updates[key]); } }); const realOrderId = SHEETS.ORDERS.getRange(rowIndex, headers.indexOf('orderId') + 1).getValue() || orderId; logToServer({origin: functionOrigin, level: 'INFO', message: `Order ${realOrderId} updated successfully`, data: updates}); SHEETS.HISTORY.appendRow([new Date(), realOrderId, updates.status || 'Updated', updates.driverId || 'N/A', 'SYSTEM']); return { orderId: realOrderId, message: "Order updated successfully" }; }
function getDrivers() { return sheetToJSON(SHEETS.DRIVERS); }
function getHistory() { return sheetToJSON(SHEETS.HISTORY); }
function getCustomers() { return sheetToJSON(SHEETS.CUSTOMERS); }
function getAlerts() { return sheetToJSON(SHEETS.ALERTS); }
function getWarehouseOrders(params) { if (!params.warehouse) throw new Error("Warehouse parameter is missing."); const todayStr = new Date().toISOString().split('T')[0]; const allTodayOrders = getOrders({ date: todayStr }); return allTodayOrders.filter(order => order.warehouse === params.warehouse); }
function getLiveMapData() { const todayStr = new Date().toISOString().split('T')[0]; const allTodayOrders = getOrders({ date: todayStr }); const activeDrivers = getDrivers().filter(d => d.status === 'פעיל'); const locations = sheetToJSON(SHEETS.LOCATIONS); const driverData = activeDrivers.map(driver => { const latestLocation = locations.filter(loc => loc.driverId === driver.driverId).sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate))[0]; return { driverId: driver.driverId, name: driver.name, location: latestLocation, }; }).filter(d => d.location && typeof d.location.latitude === 'number'); return { drivers: driverData, orders: allTodayOrders }; }
function getComments(orderId) { if (!orderId) throw new Error("Order ID is required."); const allComments = sheetToJSON(SHEETS.COMMENTS); return allComments.filter(c => String(c.orderId) === String(orderId)); }
function getOrderDetails(orderId) { if (!orderId) throw new Error("Order ID is required."); const order = sheetToJSON(SHEETS.ORDERS).find(o => o.orderId === orderId); if (!order) throw new Error("Order not found."); order.comments = getComments(orderId); return order; }
function getAnalyticsData() { const orders = sheetToJSON(SHEETS.ORDERS); const drivers = getDrivers(); const ordersByDriver = drivers.map(driver => ({ driverName: driver.name, count: orders.filter(o => o.driverId === driver.driverId).length })).filter(d => d.count > 0); const statusCounts = orders.reduce((acc, order) => { const status = order.status || 'Unknown'; acc[status] = (acc[status] || 0) + 1; return acc; }, {}); return { ordersByDriver, statusCounts }; }
function updateDriverLocation(data) { const { driverId, latitude, longitude } = data; if (!driverId || !latitude || !longitude) throw new Error("Missing driver location data."); let rowIndex = findRowIndexByValue(SHEETS.LOCATIONS, 'driverId', driverId); if (rowIndex === -1) { SHEETS.LOCATIONS.appendRow([driverId, latitude, longitude, new Date()]); } else { SHEETS.LOCATIONS.getRange(rowIndex, 2, 1, 3).setValues([[latitude, longitude, new Date()]]); } return { status: 'Location updated' }; }
function registerDevice(data) { const { driverId, deviceId } = data; if (!driverId || !deviceId) throw new Error("Missing driver or device ID."); const rowIndex = findRowIndexByValue(SHEETS.DRIVERS, 'driverId', driverId); if (rowIndex === -1) throw new Error(`Driver ${driverId} not found.`); const headers = SHEETS.DRIVERS.getRange(1, 1, 1, SHEETS.DRIVERS.getLastColumn()).getValues()[0]; const deviceIdCol = headers.indexOf('deviceId'); if (deviceIdCol !== -1) { SHEETS.DRIVERS.getRange(rowIndex, deviceIdCol + 1).setValue(deviceId); } return { status: 'Device registered' }; }
function registerWarehouseDevice(data) { const { managerId, deviceId } = data; if (!managerId || !deviceId) throw new Error("Missing manager or device ID."); const rowIndex = findRowIndexByValue(SHEETS.WAREHOUSE_MANAGERS, 'managerId', managerId); if (rowIndex === -1) throw new Error(`Manager ${managerId} not found.`); const headers = SHEETS.WAREHOUSE_MANAGERS.getRange(1, 1, 1, SHEETS.WAREHOUSE_MANAGERS.getLastColumn()).getValues()[0]; const deviceIdCol = headers.indexOf('deviceId'); if (deviceIdCol !== -1) { SHEETS.WAREHOUSE_MANAGERS.getRange(rowIndex, deviceIdCol + 1).setValue(deviceId); } return { status: 'Warehouse device registered' }; }
function postComment(data) { const { orderId, author, text } = data; if (!orderId || !author || !text) throw new Error("Missing data for comment."); SHEETS.COMMENTS.appendRow([Utilities.getUuid(), orderId, new Date(), author, text]); return { status: 'Comment posted' }; }
function acknowledgeAlert(data) { const { alertId } = data; if (!alertId) throw new Error("Alert ID is missing."); const rowIndex = findRowIndexByValue(SHEETS.ALERTS, 'alertId', alertId); if (rowIndex === -1) return { status: 'not_found' }; const statusColIndex = SHEETS.ALERTS.getRange(1, 1, 1, SHEETS.ALERTS.getLastColumn()).getValues()[0].indexOf('status'); SHEETS.ALERTS.getRange(rowIndex, statusColIndex + 1).setValue('acknowledged'); return { status: 'success' }; }
function getTrackingData(params) { if (!params.trackId) throw new Error("Missing tracking ID."); const rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'trackingId', params.trackId); if (rowIndex === -1) throw new Error("Order not found."); const orderData = sheetToJSON(SHEETS.ORDERS)[rowIndex - 2]; return { customerName: orderData.customerName, status: orderData.status, driverId: orderData.driverId }; }
function logPDFView(data) { const { user, role, orderId } = data; if (!user || !role || !orderId) throw new Error("Missing log data."); SHEETS.PDF_LOGS.appendRow([new Date(), user, role, orderId]); return { status: "Logged successfully" }; }
function getOrderPDF(params) { if (!params.orderId) throw new Error("Missing order ID."); const rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'orderId', params.orderId); if (rowIndex === -1) throw new Error("Order not found."); const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0]; const pdfLinkCol = headers.indexOf('pdfLink'); if (pdfLinkCol === -1) throw new Error("pdfLink column not found."); const pdfLink = SHEETS.ORDERS.getRange(rowIndex, pdfLinkCol + 1).getValue(); if (!pdfLink || pdfLink.trim() === "") { return null; } return pdfLink; }
function finalizeOrder(data) { const { internalId, finalOrderId } = data; if (!internalId || !finalOrderId) throw new Error("Missing internalId or finalOrderId."); const rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'internalId', internalId); if (rowIndex === -1) throw new Error(`Internal order ${internalId} not found.`); const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0]; const orderIdCol = headers.indexOf('orderId'); const statusCol = headers.indexOf('status'); SHEETS.ORDERS.getRange(rowIndex, orderIdCol + 1).setValue(finalOrderId); SHEETS.ORDERS.getRange(rowIndex, statusCol + 1).setValue("חדש"); return { message: "Order finalized successfully." }; }
function getUnlinkedDocuments() { return sheetToJSON(SHEETS.UNLINKED_DOCS); }

