/**
 * =================================================================
 * DeliveryMaster - Backend Engine (Google Apps Script)
 * v15.1 - Data Integrity and Date/Time Fix
 * =================================================================
 * Change Log:
 * - Patched `sheetToJSON` to correctly parse and format date-only vs. time-only columns.
 * This fixes the "undefined" time issue in the warehouse app.
 * - All other functions from v15.0 remain intact.
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
};
const LOCK = LockService.getScriptLock();

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
      case 'getAnalyticsData': responseData = getAnalyticsData(); break;
      case 'getAlerts': responseData = getAlerts(); break;
      case 'getWarehouseOrders': responseData = getWarehouseOrders(e.parameter); break;
      case 'getOrderDetails': responseData = getOrderDetails(e.parameter.orderId); break;
      case 'getComments': responseData = getComments(e.parameter.orderId); break;
      default: throw new Error(`Invalid GET action: ${action}`);
    }
    return createJsonResponse({ status: "success", data: responseData });
  } catch (error) {
    Logger.log(`GET Error: Action [${e.parameter.action}] - ${error.stack}`);
    return createJsonResponse({ status: "error", message: `GET request failed: ${error.message}` });
  }
}

function doPost(e) {
  if (!LOCK.tryLock(15000)) {
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

// --- UTILITY FUNCTIONS ---
function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * FIX: This function now correctly distinguishes between date and time columns.
 * It checks the header name. If it contains 'time', it formats as HH:mm.
 * Otherwise, it formats as yyyy-MM-dd. This is critical for the warehouse app.
 */
function sheetToJSON(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(h => h.trim());
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
        Logger.log(`Geocoding failed for address "${address}": ${e.toString()}`);
        return { latitude: null, longitude: null };
    }
}

// --- GET IMPLEMENTATIONS ---
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
    const order = sheetToJSON(SHEETS.ORDERS).find(o => o.orderId === orderId);
    if (!order) throw new Error("Order not found.");
    order.comments = getComments(orderId);
    return order;
}

function getAnalyticsData() {
    const orders = sheetToJSON(SHEETS.ORDERS);
    const drivers = getDrivers();
    const ordersByDriver = drivers.map(driver => {
        return {
            driverName: driver.name,
            count: orders.filter(o => o.driverId === driver.driverId).length
        };
    }).filter(d => d.count > 0);

    const statusCounts = orders.reduce((acc, order) => {
        const status = order.status || 'Unknown';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});
    
    return { ordersByDriver, statusCounts };
}


// --- POST IMPLEMENTATIONS ---
function createOrder(data) {
    const { customerName, address, deliveryType } = data;
    if (!customerName || !address) throw new Error("Missing customer name or address.");
    
    const coords = getCoordinatesForAddress(address);
    const now = new Date();
    const newOrder = {
        orderId: "ORD-" + Utilities.getUuid().substring(0, 6).toUpperCase(),
        orderDate: now,
        orderTime: now,
        customerName,
        address,
        latitude: coords.latitude,
        longitude: coords.longitude,
        deliveryType,
        status: "חדש",
        driverId: "",
        warehouse: "החרש" // Default warehouse, can be changed
    };
    
    const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
    const newRow = headers.map(header => newOrder[header] || "");
    SHEETS.ORDERS.appendRow(newRow);
    
    return { orderId: newOrder.orderId, message: "Order created successfully" };
}

function updateOrder(data) {
    const { orderId, updates } = data;
    if (!orderId || !updates) throw new Error("Order ID or updates object is missing.");
    
    const rowIndex = findRowIndexByValue(SHEETS.ORDERS, 'orderId', orderId);
    if (rowIndex === -1) throw new Error(`Order ${orderId} not found.`);
    
    const headers = SHEETS.ORDERS.getRange(1, 1, 1, SHEETS.ORDERS.getLastColumn()).getValues()[0];
    Object.keys(updates).forEach(key => {
        const colIndex = headers.indexOf(key);
        if (colIndex !== -1) {
            SHEETS.ORDERS.getRange(rowIndex, colIndex + 1).setValue(updates[key]);
        }
    });
    
    // Log to history
    SHEETS.HISTORY.appendRow([new Date(), orderId, updates.status || 'Updated', updates.driverId || 'N/A', 'SYSTEM']);
    return { orderId, message: "Order updated successfully" };
}

function updateDriverLocation(data) {
    const { driverId, latitude, longitude } = data;
    if (!driverId || !latitude || !longitude) throw new Error("Missing driver location data.");
    
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
    SHEETS.COMMENTS.appendRow([Utilities.getUuid(), orderId, new Date(), author, text]);
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

