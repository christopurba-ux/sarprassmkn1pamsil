/** Google Apps Script backend for the SARPRAS browser app. */
var DEFAULT_FIREBASE_DATABASE_URL = 'https://sarpras-9bddb-default-rtdb.asia-southeast1.firebasedatabase.app';
var DEFAULT_FIREBASE_WEB_API_KEY = 'AIzaSyDwOT75aU0Ret-6kNXKCVXaWUCAnt8FPiY';
var DEFAULT_SPREADSHEET_ID = '1C1DYPRg_Iau_AwiAfnAPy4eD3ZMz5wa3RTD2FD6t9RU';

function setupSarpras() {
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('FIREBASE_DATABASE_URL')) {
    properties.setProperty('FIREBASE_DATABASE_URL', DEFAULT_FIREBASE_DATABASE_URL);
  }
  properties.setProperty('SPREADSHEET_ID', DEFAULT_SPREADSHEET_ID);

  var spreadsheet = getOrCreateSpreadsheet_();
  getSheetWithHeader_(spreadsheet, 'Users', ['Username', 'Email Firebase', 'Aktif', 'Role', 'Nama']);
  getOrCreateFolder_('SARPRAS_PHOTO_ROOT_ID', 'SARPRAS_FOTO');
  getOrCreateFolder_('SARPRAS_SIGNATURE_ROOT_ID', 'SARPRAS_TANDA_TANGAN');
  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    photoFolderId: properties.getProperty('SARPRAS_PHOTO_ROOT_ID'),
    signatureFolderId: properties.getProperty('SARPRAS_SIGNATURE_ROOT_ID')
  };
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var snapshot = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!verifyFirebaseIdToken_(snapshot.authToken)) throw new Error('Akses ditolak: sesi Firebase tidak valid.');
    delete snapshot.authToken;
    setupSarpras();
    snapshot = normalizeSnapshot_(snapshot);

    // Snapshot masuk adalah data resmi. Jangan merge agar penghapusan benar-benar tersimpan.
    var savedPhotoCount = savePhotosToDrive_(snapshot.items);
    if (snapshot.signature) snapshot.signature = saveSignatureToDrive_(snapshot.signature);
    snapshot.updatedAt = new Date().toISOString();
    writeFirebaseSnapshot_(snapshot);
    return jsonResponse_({ ok: true, savedPhotoCount: savedPhotoCount, syncedAt: snapshot.updatedAt });
  } catch (error) {
    return jsonResponse_({ ok: false, error: String(error) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  if (params.action === 'checkUser') {
    var result;
    try {
      setupSarpras();
      result = findLoginUser_(params.username || '');
    } catch (error) {
      result = { ok: false, error: 'Layanan akun tidak tersedia.' };
    }
    return jsonpOrJsonResponse_(result, params.callback);
  }

  var snapshot = null;
  try {
    if (!verifyFirebaseIdToken_(params.idToken)) throw new Error('Akses ditolak: sesi Firebase tidak valid.');
    setupSarpras();
    snapshot = readFirebaseSnapshot_();
  } catch (error) {
    snapshot = { error: String(error) };
  }
  var callback = e && e.parameter && e.parameter.callback;
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(snapshot || {}) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse_(snapshot || { error: 'Data tidak tersedia.' });
}

function findLoginUser_(username) {
  var normalized = String(username || '').trim().toLowerCase();
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(normalized)) return { ok: false };

  var sheet = getOrCreateSpreadsheet_().getSheetByName('Users');
  if (!sheet || sheet.getLastRow() < 2) return { ok: false };
  var rows = sheet.getDataRange().getDisplayValues();
  var headers = rows[0].map(function(value) { return String(value).trim().toLowerCase(); });
  var usernameCol = headers.indexOf('username');
  var emailCol = headers.indexOf('email firebase');
  var activeCol = headers.indexOf('aktif');
  var roleCol = headers.indexOf('role');
  var nameCol = headers.indexOf('nama');
  if (usernameCol < 0 || emailCol < 0 || activeCol < 0) return { ok: false, error: 'Kolom sheet Users tidak lengkap.' };

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][usernameCol]).trim().toLowerCase() !== normalized) continue;
    var active = String(rows[i][activeCol]).trim().toLowerCase();
    if (!['ya', 'yes', 'true', 'aktif', '1'].includes(active)) return { ok: false };
    var email = String(rows[i][emailCol] || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Email Firebase pada akun ini belum valid.' };
    return {
      ok: true,
      user: {
        username: String(rows[i][usernameCol]).trim(),
        email: email,
        role: roleCol < 0 ? '' : String(rows[i][roleCol] || '').trim(),
        name: nameCol < 0 ? '' : String(rows[i][nameCol] || '').trim()
      }
    };
  }
  return { ok: false };
}

function verifyFirebaseIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string') return false;
  var properties = PropertiesService.getScriptProperties();
  var apiKey = properties.getProperty('FIREBASE_WEB_API_KEY') || DEFAULT_FIREBASE_WEB_API_KEY;
  var response = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return false;
  var result = JSON.parse(response.getContentText() || '{}');
  return Array.isArray(result.users) && result.users.length > 0;
}

function jsonpOrJsonResponse_(value, callback) {
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(value) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse_(value);
}

function normalizeSnapshot_(snapshot) {
  snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  snapshot.items = Array.isArray(snapshot.items) ? snapshot.items : [];
  snapshot.loans = Array.isArray(snapshot.loans) ? snapshot.loans : [];
  snapshot.audit = Array.isArray(snapshot.audit) ? snapshot.audit : [];
  snapshot.activities = Array.isArray(snapshot.activities) ? snapshot.activities : [];
  return snapshot;
}

function snapshotHasData_(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  return ['items', 'loans', 'audit', 'activities'].some(function(key) {
    return Array.isArray(snapshot[key]) && snapshot[key].length > 0;
  }) || Boolean(snapshot.signature);
}

function mergeSnapshots_(remote, incoming) {
  remote = normalizeSnapshot_(remote);
  incoming = normalizeSnapshot_(incoming);
  return {
    items: mergeRecords_(remote.items, incoming.items, 'kode'),
    loans: mergeRecords_(remote.loans, incoming.loans, 'id'),
    audit: mergeRecords_(remote.audit, incoming.audit, 'time'),
    activities: Array.from(new Set(remote.activities.concat(incoming.activities))).slice(-500),
    signature: incoming.signature || remote.signature || '',
    updatedAt: incoming.updatedAt || new Date().toISOString()
  };
}

function mergeRecords_(oldRows, newRows, key) {
  var records = {};
  oldRows.concat(newRows).forEach(function(row, index) {
    if (!row || typeof row !== 'object') return;
    var id = row[key] !== undefined && row[key] !== '' ? String(row[key]) : 'row-' + index;
    records[id] = Object.assign({}, records[id] || {}, row);
  });
  return Object.keys(records).map(function(id) { return records[id]; });
}

function getOrCreateSpreadsheet_() {
  var properties = PropertiesService.getScriptProperties();
  var id = properties.getProperty('SPREADSHEET_ID') || DEFAULT_SPREADSHEET_ID;
  try {
    return SpreadsheetApp.openById(id);
  } catch (error) {
    throw new Error('Spreadsheet tidak dapat dibuka. Pastikan ID benar dan akun Apps Script memiliki akses edit: ' + id);
  }
}

function getOrCreateFolder_(propertyName, folderName) {
  var properties = PropertiesService.getScriptProperties();
  var id = properties.getProperty(propertyName);
  var folder;
  if (id) {
    try { folder = DriveApp.getFolderById(id); } catch (error) { console.warn(error); }
  }
  if (!folder) {
    folder = DriveApp.createFolder(folderName);
    properties.setProperty(propertyName, folder.getId());
  }
  return folder;
}

function readFirebaseSnapshot_() {
  var properties = PropertiesService.getScriptProperties();
  var databaseUrl = properties.getProperty('FIREBASE_DATABASE_URL') || DEFAULT_FIREBASE_DATABASE_URL;
  var url = databaseUrl.replace(/\/+$/, '') + '/sarpras.json';
  var token = properties.getProperty('FIREBASE_AUTH_TOKEN');
  if (token) url += '?auth=' + encodeURIComponent(token);
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firebase tidak dapat dibaca: HTTP ' + response.getResponseCode());
  }
  return JSON.parse(response.getContentText() || 'null');
}

function savePhotosToDrive_(items) {
  var root = getOrCreateFolder_('SARPRAS_PHOTO_ROOT_ID', 'SARPRAS_FOTO');
  var saved = 0;
  items.forEach(function(item) {
    var match = String(item.foto || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!match || !item.kode) return;

    var code = String(item.kode).replace(/[^a-zA-Z0-9._-]/g, '_');
    var mime = match[1].toLowerCase();
    var extension = mime.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    var filename = code + '.' + extension;
    var folderIterator = root.getFoldersByName(code);
    var folder = folderIterator.hasNext() ? folderIterator.next() : root.createFolder(code);
    var existingFiles = folder.getFilesByName(filename);
    if (existingFiles.hasNext()) {
      var existingFile = existingFiles.next();
      try { existingFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (sharingError) { console.warn(sharingError); }
      item.foto = 'https://drive.google.com/thumbnail?id=' + existingFile.getId() + '&sz=w1000';
      item.fotoNama = filename;
      return;
    }

    var bytes = Utilities.base64Decode(match[2]);
    var file = folder.createFile(Utilities.newBlob(bytes, mime, filename));
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (sharingError) { console.warn(sharingError); }
    item.foto = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
    item.fotoNama = filename;
    saved++;
  });
  return saved;
}

function saveSignatureToDrive_(dataUrl) {
  var match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) return dataUrl;
  var folder = getOrCreateFolder_('SARPRAS_SIGNATURE_ROOT_ID', 'SARPRAS_TANDA_TANGAN');
  var mime = match[1].toLowerCase();
  var extension = mime.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  var filename = 'Tanda_Tangan_Petugas_' + new Date().getTime() + '.' + extension;
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(match[2]), mime, filename));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (sharingError) { console.warn(sharingError); }
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
}

function getSheetWithHeader_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  return sheet;
}

function writeFirebaseSnapshot_(snapshot) {
  var properties = PropertiesService.getScriptProperties();
  var databaseUrl = properties.getProperty('FIREBASE_DATABASE_URL') || DEFAULT_FIREBASE_DATABASE_URL;
  var url = databaseUrl.replace(/\/+$/, '') + '/sarpras.json';
  var token = properties.getProperty('FIREBASE_AUTH_TOKEN');
  if (token) url += '?auth=' + encodeURIComponent(token);
  var response = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(snapshot),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firebase menolak sinkronisasi: HTTP ' + response.getResponseCode());
  }
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
