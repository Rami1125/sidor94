/**
 * =================================================================
 * DeliveryMaster - Backend Engine (Google Apps Script)
 * v29.1 - Hybrid Sync & Embeddable URL Fix
 * =================================================================
 * Change Log:
 * - v29.1:
 * - Fixed PDF permission issue by changing the generated URL from /view to /preview for proper embedding in iframes. This was applied to both `processComaxEmails` and `processDriveFiles`.
 * - Added a new utility function `fixExistingPdfLinks()` to run once and correct all historical URLs in the Orders sheet.
 * - v29.0:
 * - Implemented Hybrid Sync mode (Email & Drive).
 * - Created `runFullSync` as the master trigger function.
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
  SYSTEM_LOGS: SS.getSheetByName("System_Logs"), 
  EMAIL_LOGS: SS.getSheetByName("Email_Logs")
};
const LOCK = LockService.getScriptLock();

// --- CONFIGURATION FROM SETTINGS SHEET ---
function getSetting(key) {
  try {
    const settings = sheetToJSON(SHEETS.SETTINGS);
    const setting = settings.find(s => s.key === key);
    return setting ? setting.value : null;
  } catch (e) {
    return null; // Return null if settings sheet is unavailable
  }
}

const PDF_DRIVE_FOLDER_ID = getSetting('1y6Zf27-alT_lrKGdr1_GSQpUj06hGS42'); 
const COMAX_EMAIL_SENDER = getSetting('orders.sidor94@gmail.com');
const GMAIL_QUERY = `from:(${COMAX_EMAIL_SENDER}) is:unread has:attachment to:orders.sidor94@gmail.com`;

// --- API ROUTING (GET/POST) ---
function doGet(e) {
  try {
    const action = e.parameter.action;
    let responseData;
    switch (action) {
      case 'getOrders': responseData = getOrders(e.parameter); break;
      case 'getDrivers': responseData = getDrivers(); break;
      case 'getLiveMapData': responseData = getLiveMapData(); break;
      case 'getCustomers': responseData = getCustomers(); break;
      case 'getHistory': responseData = getHistory(); break;
      case 'getAlerts': responseData = getAlerts(); break;
      case 'getWarehouseOrders': responseData = getWarehouseOrders(e.parameter); break;
      case 'getOrderDetails': responseData = getOrderDetails(e.parameter.orderId); break;
      case 'getComments': responseData = getComments(e.parameter.orderId); break;
      case 'getOrderPDF': responseData = getOrderPDF(e.parameter); break;
      case 'getSyncStatus': responseData = getSyncStatus(); break;
      case 'getVersion': responseData = { version: "29.1" }; break;
      default: throw new Error(`Invalid GET action: ${action}`);
    }
    return createJsonResponse({ status: "success", data: responseData });
  } catch (error) {
    Logger.log(`GET Error: Action [${e.parameter.action}] - ${error.stack}`);
    return createJsonResponse({ status: "error", message: `GET request failed: ${error.message}` });
  }
}

function doPost(e) {
  if (!LOCK.tryLock(30000)) { // Increased lock time for dual processing
     return createJsonResponse({ status: "error", message: "Server is busy, please try again." });
  }
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    let responseData;
    switch(action) {
        case 'createOrder': responseData = createOrder(payload.data); break;
        case 'updateOrder': responseData = updateOrder(payload.data); break;
        case 'postComment': responseData = postComment(payload.data); break;
        case 'acknowledgeAlert': responseData = acknowledgeAlert(payload.data); break;
        case 'updateDriverLocation': responseData = updateDriverLocation(payload.data); break;
        case 'registerDevice': responseData = registerDevice(payload.data); break;
        case 'registerWarehouseDevice': responseData = registerWarehouseDevice(payload.data); break;
        case 'logToServer': responseData = logToServer(payload.data); break;
        case 'logPDFView': responseData = logPDFView(payload.data); break;
        case 'finalizeOrder': responseData = finalizeOrder(payload.data); break;
        case 'processComaxEmails': responseData = processComaxEmails(); break;
        case 'processDriveFiles': responseData = processDriveFiles(); break; // Allow manual trigger
        default: throw new Error(`Invalid POST action: ${action}`);
    }
    return createJsonResponse({ status: "success", data: responseData });
  } catch (error) {
    Logger.log(`POST Error: Action [${JSON.parse(e.postData.contents).action}] - ${error.stack}`);
    return createJsonResponse({ status: "error", message: `POST request failed: ${error.message}` });
  } finally {
    LOCK.releaseLock();
  }
}

// --- v29.1 Maintenance Function ---
/**
 * A one-time utility to fix all existing PDF links in the Orders sheet.
 * It changes the URL from a 'view' link to an embeddable 'preview' link.
 */
function fixExistingPdfLinks() {
  const sheet = SHEETS.ORDERS;
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const pdfLinkCol = headers.indexOf('pdfLink');
  let fixedCount = 0;

  if (pdfLinkCol === -1) {
    Logger.log("Error: 'pdfLink' column not found.");
    return;
  }

  for (let i = 1; i < data.length; i++) {
    let url = data[i][pdfLinkCol];
    if (url && typeof url === 'string' && url.includes('/view')) {
      const newUrl = url.replace(/\/view\?usp=sharing$/, '/preview').replace(/\/view$/, '/preview');
      sheet.getRange(i + 1, pdfLinkCol + 1).setValue(newUrl);
      fixedCount++;
    }
  }
  Logger.log(`Finished fixing PDF links. Total links updated: ${fixedCount}`);
}


// --- v29.0 Hybrid Automation ---
/**
 * Master sync function that runs both email and Drive processing.
 * This is the function that the trigger will now call.
 */
function runFullSync() {
  logToServer({ origin: 'Backend', level: 'info', message: 'Starting full hybrid sync...' });
  processComaxEmails();
  processDriveFiles();
  logToServer({ origin: 'Backend', level: 'info', message: 'Full hybrid sync finished.' });
}

/**
 * Creates a time-driven trigger to run the new master sync function.
 */
function createMailSyncTrigger() {
  // Clean up any old triggers to prevent duplicates.
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processComaxEmails' || t.getHandlerFunction() === 'runFullSync') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Create a new trigger that runs the master sync function every 5 minutes.
  ScriptApp.newTrigger('runFullSync')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log("Hybrid sync trigger created successfully to run every 5 minutes.");
}


// --- UTILITY FUNCTIONS ---
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheetToJSON(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(h => String(h || "").trim());
  return values.map(row => headers.reduce((obj, header, i) => {
    let val = row[i];
    if (val instanceof Date) {
      if (header.toLowerCase().includes('time')) {
         obj[header] = Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm");
      } else {
         obj[header] = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
      }
    } else {
      obj[header] = val;
    }
    return obj;
  }, {}));
}

function findRowIndexByValue(sheet, headerName, value) {
  if (!sheet) return -1;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = headers.indexOf(headerName);
  if (colIndex === -1) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues().flat().map(String);
  const rowIndex = values.indexOf(String(value));
  return (rowIndex === -1) ? -1 : rowIndex + 2;
}

function getCoordinatesForAddress(address) {
    try {
        const geocoder = Maps.newGeocoder().setLanguage('iw');
        const response = geocoder.geocode(address);
        if (response.status === 'OK' && response.results.length > 0) {
            const location = response.results[0].geometry.location;
            return { latitude: location.lat, longitude: location.lng };
        }
        return { latitude: null, longitude: null };
    } catch (e) {
        logToServer({origin: 'Backend', level: 'error', message: `Geocoding failed for address "${address}": ${e.toString()}`});
        return { latitude: null, longitude: null };
    }
}

// --- CORE GET IMPLEMENTATIONS ---
function getOrders(params) {
  let allOrders = sheetToJSON(SHEETS.ORDERS);
  if (params && params.date) {
    const requestedDateStr = new Date(params.date).toISOString().split('T')[0];
    allOrders = allOrders.filter(order => order.orderDate && order.orderDate.startsWith(requestedDateStr));
  }
  if (params && params.driverId) {
    allOrders = allOrders.filter(order => order.driverId === params.driverId);
  }
  return allOrders;
}

function getDrivers() { return sheetToJSON(SHEETS.DRIVERS); }
function getHistory() { return sheetToJSON(SHEETS.HISTORY); }
function getCustomers() { return sheetToJSON(SHEETS.CUSTOMERS); }
function getAlerts() { return sheetToJSON(SHEETS.ALERTS); }

function getWarehouseOrders(params) {
  if (!params.warehouse) throw new Error("Warehouse parameter is missing.");
  const todayStr = new Date().toISOString().split('T')[0];
  const allTodayOrders = getOrders({ date: todayStr });
  return allTodayOrders.filter(order => order.warehouse === params.warehouse);
}

function getLiveMapData() {
  const todayStr = new Date().toISOString().split('T')[0];
  const allTodayOrders = getOrders({ date: todayStr });
  const activeDrivers = getDrivers().filter(d => d.status === 'פעיל');
  const locations = sheetToJSON(SHEETS.LOCATIONS);
  
  const driverData = activeDrivers.map(driver => {
    const latestLocation = locations
      .filter(loc => loc.driverId === driver.driverId)
      .sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate))[0];
    return { 
      driverId: driver.driverId, 
      name: driver.name, 
      location: latestLocation,
    };
  }).filter(d => d.location && typeof d.location.latitude === 'number');

  return { drivers: driverData, orders: allTodayOrders };
}

function getComments(orderId) {
    if (!orderId) throw new Error("Order ID is required.");
    return sheetToJSON(SHEETS.COMMENTS).filter(c => c.orderId === orderId);
}

function getOrderDetails(orderId) {
    if (!orderId) throw new Error("Order ID is required.");
    const order = sheetToJSON(SHEETS.ORDERS).find(o => o.orderId === orderId || o.internalId === orderId);
    if (!order) throw new Error("Order not found.");
    order.comments = getComments(orderId);
    return order;
}

// --- CORE POST IMPLEMENTATIONS ---
function createOrder(data) {
    const { customerName, city, street, houseNumber, customerId } = data;
    if (!customerName || !city || !street || !houseNumber) throw new Error("Missing required fields for order creation.");
    
    const fullAddress = `${street} ${houseNumber}, ${city}`;
    const coords = getCoordinatesForAddress(fullAddress);
    const now = new Date();
    const internalId = "INT-" + Utilities.getUuid().substring(0, 6).toUpperCase();

    const newOrder = [
        "", // orderId
        customerId || "",
        customerName,
        fullAddress,
        data.deliveryType || "",
        "החרש", // Default warehouse
        now, // orderDate
        Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm"), // orderTime
        "", // driverId
        "ממתין למספר", // status
        "", // notes
        now, // createdAt
        now, // lastModified
        coords.longitude,
        coords.latitude,
        "", "", // photo/signature
        data.customerPhone || "",
        "", "", // history/internalNote
        "", "", // pdfLink/fileTimestamp
        internalId
    ];
    
    SHEETS.ORDERS.appendRow(newOrder);
    logToServer({ origin: 'Admin', level: 'success', message: 'Placeholder order created', data: { internalId, customerName } });
    return { internalId: internalId, message: "Placeholder order created successfully" };
}

function updateOrder(data) {
    const { orderId, updates } = data;
    if (!orderId || !updates) throw new Error("Order ID or updates object is missing.");
    
    let rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'orderId', orderId);
    if (rowIndex === -1) rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'internalId', orderId);
    if (rowIndex === -1) throw new Error(`Order ${orderId} not found.`);
    
    const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
    Object.keys(updates).forEach(key => {
        const colIndex = headers.indexOf(key);
        if (colIndex !== -1) {
            SHEETS.ORDERS.getRange(rowIndex, colIndex + 1).setValue(updates[key]);
        }
    });
    
    logToServer({origin: 'System', level: 'info', message: `Order ${orderId} updated`, data: updates});
    return { orderId, message: "Order updated successfully" };
}

function updateDriverLocation(data) {
    const { driverId, latitude, longitude } = data;
    if (!driverId || !latitude || !longitude) return; // Fail silently
    
    let rowIndex = findRowIndexByValue(SHEETS.LOCATIONS, 'driverId', driverId);
    if (rowIndex === -1) {
        SHEETS.LOCATIONS.appendRow([driverId, latitude, longitude, new Date()]);
    } else {
        SHEETS.LOCATIONS.getRange(rowIndex, 2, 1, 3).setValues([[latitude, longitude, new Date()]]);
    }
    return { status: 'Location updated' };
}

function registerDevice(data) {
    const { driverId, deviceId } = data;
    if (!driverId || !deviceId) throw new Error("Missing driver or device ID.");
    
    const rowIndex = findRowIndexByValue(SHEETS.DRIVERS, 'driverId', driverId);
    if (rowIndex === -1) throw new Error(`Driver ${driverId} not found.`);
    
    const headers = SHEETS.DRIVERS.getRange(1, 1, 1, SHEETS.DRIVERS.getLastColumn()).getValues()[0];
    const deviceIdCol = headers.indexOf('deviceId');
    if (deviceIdCol !== -1) {
        SHEETS.DRIVERS.getRange(rowIndex, deviceIdCol + 1).setValue(deviceId);
    }
    logToServer({origin: 'DriverApp', level: 'info', message: `Device registered for ${driverId}`});
    return { status: 'Device registered' };
}

function registerWarehouseDevice(data) {
    const { managerId, deviceId } = data;
    if (!managerId || !deviceId) throw new Error("Missing manager or device ID.");
    
    const rowIndex = findRowIndexByValue(SHEETS.WAREHOUSE_MANAGERS, 'managerId', managerId);
    if (rowIndex === -1) throw new Error(`Manager ${managerId} not found.`);
    
    const headers = SHEETS.WAREHOUSE_MANAGERS.getRange(1, 1, 1, SHEETS.WAREHOUSE_MANAGERS.getLastColumn()).getValues()[0];
    const deviceIdCol = headers.indexOf('deviceId');
    if (deviceIdCol !== -1) {
        SHEETS.WAREHOUSE_MANAGERS.getRange(rowIndex, deviceIdCol + 1).setValue(deviceId);
    }
    return { status: 'Warehouse device registered' };
}

function postComment(data) {
    const { orderId, author, text } = data;
    if (!orderId || !author || !text) throw new Error("Missing data for comment.");
    SHEETS.COMMENTS.appendRow([Utilities.getUuid(), orderId, author, text, new Date()]);
    return { status: 'Comment posted' };
}

function acknowledgeAlert(data) {
    const { alertId } = data;
    if (!alertId) throw new Error("Alert ID is missing.");
    const rowIndex = findRowIndexByValue(SHEETS.ALERTS, 'alertId', alertId);
    if (rowIndex === -1) return { status: 'not_found' };
    const statusColIndex = SHEETS.ALERTS.getRange(1, 1, 1, SHEETS.ALERTS.getLastColumn()).getValues()[0].indexOf('status');
    SHEETS.ALERTS.getRange(rowIndex, statusColIndex + 1).setValue('acknowledged');
    return { status: 'success' };
}


// --- v27.0+ HYBRID SYNC & AUTOMATION ENGINE ---

/**
 * Main function to process emails from Comax.
 */
function processComaxEmails() {
    if (!PDF_DRIVE_FOLDER_ID || !COMAX_EMAIL_SENDER) {
        const message = "Configuration missing: pdfDriveFolderId or comaxEmailSender is not set in Settings sheet.";
        logToServer({ origin: 'Backend', level: 'error', message: message });
        SHEETS.EMAIL_LOGS.appendRow([new Date(), 'processComaxEmails', 'Error', message, 'Configuration']);
        return;
    }

    const threads = GmailApp.search(GMAIL_QUERY);
    let processedCount = 0;
    let errorCount = 0;

    threads.forEach(thread => {
        try {
            const message = thread.getMessages()[0];
            const subject = message.getSubject();
            const body = message.getPlainBody();
            
            const orderIdMatch = subject.match(/הזמנה #(\d{6,})/);
            const customerIdMatch = body.match(/מספר לקוח:\s*(\d+)/);

            if (!customerIdMatch || !orderIdMatch) {
                throw new Error("Could not extract customerId or orderId from email.");
            }

            const customerId = customerIdMatch[1];
            const orderId = orderIdMatch[1];

            // --- Hybrid Logic Upgrade ---
            const orderRowIndex = findRowIndexByValue(SHEETS.ORDERS, 'orderId', orderId);
            const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
            const pdfLinkCol = headers.indexOf('pdfLink');
            
            if (orderRowIndex !== -1) {
              const existingPdfLink = SHEETS.ORDERS.getRange(orderRowIndex, pdfLinkCol + 1).getValue();
              if (existingPdfLink) {
                  logToServer({origin: 'Backend', level: 'info', message: `Skipping email PDF for order ${orderId}, link already exists from Drive sync.`});
                  thread.markRead();
                  GmailApp.moveThreadToArchive(thread);
                  return; 
              }
            }
            // --- End Hybrid Logic ---

            let pdfLink = "";
            const attachments = message.getAttachments();
            if (attachments.length > 0) {
                const pdf = attachments.find(att => att.getContentType() === 'application/pdf');
                if (pdf) {
                    const folder = DriveApp.getFolderById(PDF_DRIVE_FOLDER_ID);
                    const file = folder.createFile(pdf.copyBlob()).setName(`${orderId}.pdf`);
                    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                    
                    // --- v29.1 URL Fix Start ---
                    const fileId = file.getId();
                    pdfLink = `https://drive.google.com/file/d/${fileId}/preview`;
                    // --- v29.1 URL Fix End ---
                }
            }

            const placeholderRowIndex = findPlaceholderOrder(customerId);
            if (placeholderRowIndex !== -1) {
                const orderIdCol = headers.indexOf('orderId') + 1;
                const statusCol = headers.indexOf('status') + 1;
                
                SHEETS.ORDERS.getRange(placeholderRowIndex, orderIdCol).setValue(orderId);
                SHEETS.ORDERS.getRange(placeholderRowIndex, statusCol).setValue("חדש");
                if (pdfLink) SHEETS.ORDERS.getRange(placeholderRowIndex, pdfLinkCol + 1).setValue(pdfLink);
                
                SHEETS.EMAIL_LOGS.appendRow([new Date(), 'processComaxEmails', 'Success', `Matched and updated order ${orderId} for customer ${customerId}`, '']);
                processedCount++;
            } else {
                 SHEETS.EMAIL_LOGS.appendRow([new Date(), 'processComaxEmails', 'Warning', `No placeholder order found for customer ${customerId}. Order ${orderId} was not created automatically.`, 'Matching']);
                 errorCount++;
            }
            
            thread.markRead();
            GmailApp.moveThreadToArchive(thread);

        } catch (e) {
            errorCount++;
            const subject = thread.getFirstMessageSubject();
            SHEETS.EMAIL_LOGS.appendRow([new Date(), 'processComaxEmails', 'Error', `Failed to process email thread "${subject}": ${e.message}`, 'Parsing']);
            const errorLabel = GmailApp.getUserLabelByName("Comax/Error") || GmailApp.createLabel("Comax/Error");
            thread.addLabel(errorLabel);
            thread.markRead();
        }
    });

    if (processedCount > 0 || errorCount > 0) {
        logToServer({ origin: 'Backend', level: 'info', message: 'processComaxEmails finished', data: `Processed: ${processedCount}, Errors: ${errorCount}` });
    }
}

/**
 * New function to process files manually added to the Google Drive folder.
 */
function processDriveFiles() {
    if (!PDF_DRIVE_FOLDER_ID) {
        logToServer({ origin: 'Backend', level: 'error', message: "processDriveFiles skipped: pdfDriveFolderId is not set." });
        return;
    }

    const folder = DriveApp.getFolderById(PDF_DRIVE_FOLDER_ID);
    const archiveFolder = getOrCreateArchiveFolder(folder);
    const files = folder.getFilesByType(MimeType.PDF);
    let processedCount = 0;

    while (files.hasNext()) {
        const file = files.next();
        const fileName = file.getName();
        const orderIdMatch = fileName.match(/^(\d{6,})/); // Extracts order ID from the start of the filename

        if (orderIdMatch) {
            const orderId = orderIdMatch[1];
            const rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'orderId', orderId);

            if (rowIndex !== -1) {
                const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
                const pdfLinkCol = headers.indexOf('pdfLink');
                const existingLink = SHEETS.ORDERS.getRange(rowIndex, pdfLinkCol + 1).getValue();

                if (!existingLink) { // Only update if the link is missing
                    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                    
                    // --- v29.1 URL Fix Start ---
                    const fileId = file.getId();
                    const fileUrl = `https://drive.google.com/file/d/${fileId}/preview`;
                    // --- v29.1 URL Fix End ---
                    
                    SHEETS.ORDERS.getRange(rowIndex, pdfLinkCol + 1).setValue(fileUrl);
                    logToServer({origin: 'Backend', level: 'success', message: `Linked PDF from Drive for order ${orderId}`});
                    processedCount++;
                }
            }
            // Archive the file regardless of whether it was linked, to prevent re-processing
            file.moveTo(archiveFolder);
        }
    }
    if (processedCount > 0) {
        logToServer({ origin: 'Backend', level: 'info', message: `processDriveFiles finished`, data: `Linked ${processedCount} files.` });
    }
}

function getOrCreateArchiveFolder(parentFolder) {
    const archiveFolders = parentFolder.getFoldersByName("Archive");
    if (archiveFolders.hasNext()) {
        return archiveFolders.next();
    } else {
        return parentFolder.createFolder("Archive");
    }
}


function findPlaceholderOrder(customerId) {
    const data = SHEETS.ORDERS.getDataRange().getValues();
    const headers = data[0];
    const customerIdCol = headers.indexOf('customerId');
    const statusCol = headers.indexOf('status');
    if (customerIdCol === -1 || statusCol === -1) return -1;

    for (let i = data.length - 1; i > 0; i--) { 
        if (String(data[i][customerIdCol]) === String(customerId) && data[i][statusCol] === "ממתין למספר") {
            return i + 1;
        }
    }
    return -1;
}

function finalizeOrder(data) {
    const { internalId, finalOrderId } = data;
    if (!internalId || !finalOrderId) throw new Error("Missing internalId or finalOrderId.");

    const rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'internalId', internalId);
    if (rowIndex === -1) throw new Error(`Internal order ${internalId} not found.`);

    const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
    const orderIdCol = headers.indexOf('orderId');
    const statusCol = headers.indexOf('status');

    SHEETS.ORDERS.getRange(rowIndex, orderIdCol + 1).setValue(finalOrderId);
    SHEETS.ORDERS.getRange(rowIndex, statusCol + 1).setValue("חדש");
    logToServer({origin: 'Admin', level: 'success', message: `Order ${internalId} finalized with ID ${finalOrderId}`});
    return { orderId: finalOrderId, message: `Order finalized successfully.` };
}

function getOrderPDF(params) {
    if (!params.orderId) throw new Error("Missing order ID.");
    const orderId = params.orderId;
    
    let rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'orderId', orderId);
    if (rowIndex === -1) rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'internalId', orderId);
    if (rowIndex === -1) return null;

    const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
    const pdfLinkCol = headers.indexOf('pdfLink');
    if (pdfLinkCol === -1) throw new Error("pdfLink column not found.");
    
    const pdfLink = SHEETS.ORDERS.getRange(rowIndex, pdfLinkCol + 1).getValue();
    return (pdfLink && pdfLink.trim() !== "") ? pdfLink : null;
}

function logPDFView(data) {
    const { user, role, orderId } = data;
    if (!user || !role || !orderId) return; // Fail silently
    SHEETS.SYSTEM_LOGS.appendRow([new Date(), user, 'INFO', `User viewed PDF for order ${orderId}`, JSON.stringify({role, orderId})]);
    return { status: "Logged successfully" };
}

function logToServer(data) {
  const { origin, level, message, data: eventData } = data;
  if (!origin || !level || !message) return; // Fail silently
  try {
    const jsonData = (typeof eventData === 'object') ? JSON.stringify(eventData) : eventData;
    SHEETS.SYSTEM_LOGS.appendRow([new Date(), origin, level.toUpperCase(), message, jsonData]);
  } catch(e) {
      // Fails silently if logging sheet is unavailable
  }
  return { status: 'Logged' };
}

function getSyncStatus() {
    try {
        const emailLogs = SHEETS.EMAIL_LOGS.getDataRange().getValues();
        if (emailLogs.length < 2) {
            return { lastEmailSync: 'N/A', errorCount: 0 };
        }
        
        const lastSyncRow = emailLogs[emailLogs.length - 1];
        const lastSyncTimestamp = new Date(lastSyncRow[0]).toLocaleString('he-IL');

        const logsHeaders = emailLogs[0];
        const statusHeaderIndex = logsHeaders.indexOf("Status");

        let errorCount = 0;
        if(statusHeaderIndex !== -1) {
           const today = new Date().toLocaleDateString('he-IL');
           errorCount = emailLogs.filter(row => row[statusHeaderIndex] === 'Error' && new Date(row[0]).toLocaleDateString('he-IL') === today).length;
        }
        
        return {
            lastEmailSync: lastSyncTimestamp,
            errorCount: errorCount
        };
    } catch (e) {
        return { lastEmailSync: 'שגיאה', errorCount: 'שגיאה' };
    }
}

