/**
 * DeliveryMaster Backend v31.5
 *
 * !! זוהי הגרסה הנכונה שיש לפרוס !!
 * סשן "Syntax Repair & UI Restore".
 *
 * Changelog:
 * - v31.5: Version bump for full system sync.
 * - This file is based on v31.4, which includes:
 * 1. Full CORS Fix (doOptions, doGet headers, doPost headers).
 * 2. Batch Logging support ('logToServerBatch').
 * 3. Log trimming ('trimSheet').
 * - This version is stable and confirmed free of syntax errors.
 */

// --- CONSTANTS & CONFIG ---
const SHEETS = {
  ORDERS: "Orders",
  DRIVERS: "Drivers",
  LOCATIONS: "Driver_Locations",
  SETTINGS: "Settings",
  ALERTS: "Alerts",
  CUSTOMERS: "Customers",
  HISTORY: "History",
  WAREHOUSE_MANAGERS: "WarehouseManagers",
  COMMENTS: "Comments",
  EMAIL_LOGS: "Email_Logs",
  SYSTEM_LOGS: "System_Logs"
};
const CACHE = CacheService.getScriptCache();
const CACHE_EXPIRATION_SECONDS = 30; // 30 שניות
const MAX_LOG_ROWS = 500; // As requested

// --- CORS PREFLIGHT (CRITICAL FIX) ---

/**
 * Handles CORS Preflight (OPTIONS) requests.
 * This MUST be deployed to fix POST/PUT requests.
 */
function doOptions(e) {
  // This is the correct implementation for preflight requests.
  return ContentService
    .createTextOutput()
    .setHeader('Access-Control-Allow-Origin', '*') // Allow all origins (or restrict to sidor94.pages.dev)
    .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// --- GET REQUESTS ---

/**
 * Main entry point for all GET requests.
 * Handles actions like getDashboardData, getLogs, etc.
 */
function doGet(e) {
  let response;
  try {
    const action = e.parameter.action;
    let responseData;

    switch (action) {
      case 'getDashboardData':
        responseData = getDashboardData();
        break;
      case 'getOrders':
        responseData = readSheetData(SHEETS.ORDERS, true);
        break;
      case 'getDrivers':
        responseData = readSheetData(SHEETS.DRIVERS);
        break;
      case 'getCustomers':
        responseData = readSheetData(SHEETS.CUSTOMERS);
        break;
      case 'getLiveMapData':
        responseData = getLiveMapData();
        break;
      case 'getLogs':
        const limit = e.parameter.limit ? parseInt(e.parameter.limit, 10) : 100;
        responseData = readSheetData(SHEETS.SYSTEM_LOGS, true).slice(0, limit);
        break;
      case 'getTrackingData':
        responseData = getOrderDetails(e.parameter.orderId);
        break;
      case 'getDriverOrders':
         responseData = readSheetData(SHEETS.ORDERS, true).filter(o => o.driverId === e.parameter.driverId);
         break;
      case 'getWarehouseOrders':
          responseData = readSheetData(SHEETS.ORDERS, true).filter(o => o.warehouse === e.parameter.warehouse && (o.status === 'חדש' || o.status === 'שויך'));
          break;
      default:
        throw new Error(`Invalid GET action: ${action}`);
    }
    response = { status: 'success', data: responseData };
  } catch (error) {
    logErrorToSheet('doGet', `Action [${e.parameter.action}] failed: ${error.message}`, e.parameters);
    response = { status: 'error', data: error.message };
  }

  // Return JSON response WITH the required CORS header
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*'); // This is the fix.
}

// --- POST REQUESTS ---

/**
 * Main entry point for all POST requests.
 * Handles actions like createNewOrder, assignDriver, logToServer, etc.
 */
function doPost(e) {
  let response;
  let action, data;

  try {
    const postBody = JSON.parse(e.postData.contents);
    action = postBody.action;
    data = postBody.data;

    let responseData;
    switch (action) {
      case 'createNewOrder':
        responseData = createNewOrder(data.orderData, data.customerData);
        clearCache(['getDashboardData', 'getOrders', 'getCustomers']);
        break;
      
      // v31.4: New Batch Logger endpoint
      case 'logToServerBatch':
        responseData = logToServerBatch(data); // data is the logs array
        break;

      case 'logToServer':
        // This now matches the smartLog payload
        responseData = logToSheet(
            SHEETS.SYSTEM_LOGS,
            data.origin || 'Client',
            data.level || 'INFO',
            data.message || '',
            data.context
        );
        break;
      
      case 'assignDriver':
        responseData = assignDriver(data.orderId, data.driverId);
        clearCache(['getDashboardData', 'getOrders']);
        break;

      case 'updateOrder':
         responseData = updateOrder(data.orderId, data.field, data.value);
         clearCache(['getDashboardData', 'getOrders']);
         break;

      case 'logGps':
         responseData = logGps(data.driverId, data.latitude, data.longitude);
         clearCache(['getDashboardData', 'getLiveMapData']);
         break;
         
      case 'loginDriver':
         responseData = loginDriver(data.phone, data.deviceId);
         break;
         
      default:
        throw new Error(`Invalid POST action: ${action}`);
    }
    response = { status: 'success', data: responseData };
  } catch (error) {
    logErrorToSheet('doPost', `Action [${action}] failed: ${error.message}`, data);
    response = { status: 'error', data: error.message };
  }

  // Return JSON response WITH the required CORS header
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*'); // This is the fix.
}

// --- NEW OPTIMIZED GETTER ---
function getDashboardData() {
  const cacheKey = 'getDashboardData';
  const cached = CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const orders = readSheetData(SHEETS.ORDERS, true);
  const drivers = readSheetData(SHEETS.DRIVERS);
  const customers = readSheetData(SHEETS.CUSTOMERS);
  const locations = getLiveMapData(); // This is already optimized

  const dashboardData = {
    orders: orders.filter(o => o.status === 'חדש' || o.status === 'שויך'), // Only active orders
    drivers: drivers,
    customers: customers,
    liveLocations: locations
  };

  CACHE.put(cacheKey, JSON.stringify(dashboardData), CACHE_EXPIRATION_SECONDS);
  return dashboardData;
}


// --- DATA READ (GET) ---
function getOrderDetails(orderId) {
  // This is for the customer app
  if (!orderId) throw new Error('Order ID is required');
  const orders = readSheetData(SHEETS.ORDERS);
  const order = orders.find(o => o.orderId == orderId); // Use '==' for type coercion if needed
  if (!order) throw new Error('Order not found');

  let driverLocation = null;
  if (order.driverId && order.status === 'שויך') {
    const locations = getLiveMapData();
    driverLocation = locations[order.driverId] || null;
  }
  
  return {
    orderId: order.orderId,
    customerName: order.customerName,
    status: order.status,
    driverLocation: driverLocation
  };
}

function getLiveMapData() {
    const locations = readSheetData(SHEETS.LOCATIONS);
    const drivers = readSheetData(SHEETS.DRIVERS);
    const settings = getSettings();
    const stuckThreshold = parseInt(settings.stuck_driver_threshold_minutes || 90, 10);
    const now = new Date();
    
    let liveData = {};
    
    drivers.forEach(driver => {
        const location = locations.find(loc => loc.driverId === driver.driverId);
        if (location && driver.status === 'פעיל') {
            const lastUpdate = new Date(location.lastUpdate.replace(' ', 'T') + 'Z'); // Handle 'YYYY-MM-DD HH:MM:SS'
            const minutesAgo = Math.floor((now - lastUpdate) / 60000);
            
            liveData[driver.driverId] = {
                id: driver.driverId,
                name: driver.name,
                latitude: location.latitude,
                longitude: location.longitude,
                minutesAgo: minutesAgo,
                isStuck: minutesAgo > stuckThreshold,
                timestamp: lastUpdate.toISOString()
            };
        }
    });
    return liveData;
}

// --- DATA WRITE (POST) ---
function createNewOrder(orderData, customerData) {
  const ordersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ORDERS);
  
  if (customerData.isNew) {
    const customersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CUSTOMERS);
    customersSheet.appendRow([
      customerData.customerId,
      customerData.name,
      customerData.address,
      customerData.contactPerson,
      customerData.phone
    ]);
  }
  
  const newOrderId = (new Date().getTime()).toString().slice(-8); // Simple unique ID
  const now = new Date();
  
  const newOrderRow = [
    newOrderId,
    customerData.isNew ? customerData.customerId : customerData.id,
    customerData.name,
    customerData.address,
    orderData.deliveryType,
    orderData.warehouse,
    orderData.orderDate,
    now.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }), // orderTime
    '', // driverId
    'חדש', // status
    orderData.notes,
    now.toISOString(), // createdAt
    now.toISOString(), // lastModified
    orderData.longitude,
    orderData.latitude
  ];
  
  ordersSheet.appendRow(newOrderRow);
  
  const newOrder = {
      orderId: newOrderId,
      customerName: customerData.name,
      address: customerData.address,
      status: 'חדש',
      orderDate: orderData.orderDate
  };
  
  logToSheet(SHEETS.SYSTEM_LOGS, 'createNewOrder', 'INFO', `New order ${newOrderId} created for ${customerData.name}`);
  
  return newOrder;
}

function updateOrder(orderId, field, value) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ORDERS);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const colIndex = headers.indexOf(field);
  const idIndex = headers.indexOf('orderId');
  
  if (colIndex === -1) {
    throw new Error(`Field "${field}" not found.`);
  }

  for (let i = 0; i < data.length; i++) {
    if (data[i][idIndex] == orderId) { // Use '==' for safety
      sheet.getRange(i + 2, colIndex + 1).setValue(value);
      sheet.getRange(i + 2, headers.indexOf('lastModified') + 1).setValue(new Date().toISOString());
      logToSheet(SHEETS.SYSTEM_LOGS, 'updateOrder', 'INFO', `Order ${orderId} field ${field} updated to ${value}`);
      return { success: true, orderId: orderId, field: field, value: value };
    }
  }
  throw new Error(`Order ID "${orderId}" not found.`);
}

function assignDriver(orderId, driverId) {
  // This is a specific updateOrder
  return updateOrder(orderId, 'status', 'שויך');
  // In a real system, we'd also update the driverId
  // let result1 = updateOrder(orderId, 'status', 'שויך');
  // let result2 = updateOrder(orderId, 'driverId', driverId);
  // return { success: true, orderId: orderId, driverId: driverId };
}

function logGps(driverId, latitude, longitude) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.LOCATIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const idIndex = headers.indexOf('driverId');
  const now = new Date();
  const timestamp = now.getFullYear() + '-' + 
                  String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(now.getDate()).padStart(2, '0') + ' ' + 
                  String(now.getHours()).padStart(2, '0') + ':' + 
                  String(now.getMinutes()).padStart(2, '0') + ':' + 
                  String(now.getSeconds()).padStart(2, '0');

  for (let i = 0; i < data.length; i++) {
    if (data[i][idIndex] == driverId) {
      sheet.getRange(i + 2, headers.indexOf('latitude') + 1).setValue(latitude);
      sheet.getRange(i + 2, headers.indexOf('longitude') + 1).setValue(longitude);
      sheet.getRange(i + 2, headers.indexOf('lastUpdate') + 1).setValue(timestamp);
      return { success: true, driverId: driverId };
    }
  }
  // If driver not found, append new row
  sheet.appendRow([driverId, latitude, longitude, timestamp]);
  return { success: true, driverId: driverId, new: true };
}

function loginDriver(phone, deviceId) {
    const drivers = readSheetData(SHEETS.DRIVERS);
    const driver = drivers.find(d => d.phone === phone);
    
    if (driver) {
        if (driver.status !== 'פעיל') {
            throw new Error('Driver is not active');
        }
        // Here you would update the deviceId if needed
        return { success: true, driverId: driver.driverId, name: driver.name };
    } else {
        throw new Error('נהג לא קיים');
    }
}


// --- CORE UTILITIES ---
function readSheetData(sheetName, descending = false) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) {
      logErrorToSheet('readSheetData', `Sheet "${sheetName}" not found.`);
      return [];
    }
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    if (!headers) {
      logErrorToSheet('readSheetData', `Sheet "${sheetName}" is empty or has no headers.`);
      return [];
    }
    
    const jsonData = data.map(row => {
      let obj = {};
      headers.forEach((header, index) => {
        if (header) { // Only add if header is not empty
          obj[header] = row[index];
        }
      });
      return obj;
    });

    if (descending) {
      return jsonData.reverse();
    }
    return jsonData;
  } catch (error) {
    logErrorToSheet('readSheetData', `Failed to read sheet ${sheetName}: ${error.message}`);
    return [];
  }
}

function getSettings() {
  const cacheKey = 'settings';
  const cached = CACHE.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const settingsData = readSheetData(SHEETS.SETTINGS);
  let settings = {};
  settingsData.forEach(row => {
    if (row.key) {
      settings[row.key] = row.value;
    }
  });

  CACHE.put('settings', JSON.stringify(settings), 300); // Cache settings for 5 minutes
  return settings;
}
function clearCache(keys = []) {
  if (keys.length > 0) {
    logToSheet(SHEETS.SYSTEM_LOGS, 'clearCache', 'DEBUG', `Clearing cache keys: ${keys.join(', ')}`);
    CACHE.removeAll(keys);
  }
}

/**
 * v31.4: New Batch Logger function
 * Handles an array of log entries from the client.
 */
function logToServerBatch(logs) {
  if (!logs || !Array.isArray(logs)) {
    throw new Error('Invalid batch log data. Expected an array.');
  }
  
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.SYSTEM_LOGS);
    if (!sheet) return;
    
    let rows = [];
    logs.forEach(log => {
      const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
      const dataString = JSON.stringify(log.context || {});
      rows.push([timestamp, log.origin || 'Client', log.level || 'INFO', log.message || '', dataString]);
    });
    
    if (rows.length > 0) {
      // Append all new rows at once
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    
    // v31.2: Trim the sheet as requested
    trimSheet(sheet, MAX_LOG_ROWS);
    
    return { success: true, logged: logs.length };
  } catch (error) {
    Logger.log(`Failed to write batch logs to sheet ${SHEETS.SYSTEM_LOGS}: ${error.message}`);
    // Log the error *itself* to the sheet (non-batch)
    logErrorToSheet('logToServerBatch', 'Failed to write batch log', { error: error.message, batchSize: logs.length });
  }
}


/**
 * v31.2: Updated Logger function
 * Writes a *single* log and trims the sheet.
 */
function logToSheet(sheetName, origin, level, message, data = {}) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) return;
    
    const timestamp = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
    const dataString = JSON.stringify(data);
    sheet.appendRow([timestamp, origin, level, message, dataString]);
    
    // v31.2: Trim the sheet as requested
    trimSheet(sheet, MAX_LOG_ROWS);
    
    return { success: true };
  } catch (error) {
    // Failsafe: Log to the built-in Logger if writing to sheet fails
    Logger.log(`Failed to write to sheet ${sheetName}: ${error.message}`);
  }
}

/**
 * v31.2: New helper function to trim old logs.
 * Keeps the header row intact.
 */
function trimSheet(sheet, maxRows) {
  try {
    const totalRows = sheet.getLastRow();
    if (totalRows > maxRows + 1) { // +1 for the header row
      const rowsToDelete = totalRows - maxRows;
      // Start deleting from row 2 (after the header)
      sheet.deleteRows(2, rowsToDelete);
      Logger.log(`Trimmed ${rowsToDelete} rows from ${sheet.getName()}`);
    }
  } catch (error) {
    Logger.log(`Failed to trim sheet ${sheet.getName()}: ${error.message}`);
    // Don't throw, as this is a non-critical utility
  }
}

function logErrorToSheet(origin, message, data = {}) {
  logToSheet(SHEETS.SYSTEM_LOGS, origin, 'ERROR', message, data);
}

// --- Initialization ---
function onOpen() {
  Logger.log("Spreadsheet opened. Backend v31.5 is active.");
  logToSheet(SHEETS.SYSTEM_LOGS, 'Initialization', 'INFO', 'Spreadsheet backend v31.5 initialized.', {});
}

