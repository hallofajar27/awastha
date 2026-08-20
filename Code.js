/**
 * Peta Sebaran Kerusakan Infrastruktur — Backend Core
 * 100% Google Apps Script V8
 * Phase 1: Setup, Auth, Drive, Report Submit
 */

// ============================================================
// KONSTANTA & KONFIGURASI
// ============================================================

const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';
const DRIVE_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID') || '';

const SHEET_NAMES = {
  RAW_LAPORAN: 'Raw_Laporan',
  MASTER_DESA: 'Master_Desa',
  MASTER_USER: 'Master_User',
  CACHE_CHOROPLETH: 'Cache_Choropleth'
};

const USER_ROLES = {
  ADMIN_POSKO: 'Admin_Posko',
  VALIDATOR: 'Validator',
  RELAWAN: 'Relawan'
};

const REPORT_STATUS = {
  MENUNGGU: 'Menunggu',
  VALID: 'Valid',
  DITOLAK: 'Ditolak'
};

const INFRA_CATEGORIES = ['Rumah', 'Faskes', 'Sekolah', 'Ibadah'];
const DAMAGE_LEVELS = ['Ringan', 'Sedang', 'Berat'];

const WEIGHTS = {
  BERAT: 1.0,
  SEDANG: 0.5,
  RINGAN: 0.2
};

const COLOR_THRESHOLDS = [
  { max: 10.0, hex: '#2ecc71', label: 'Sangat Rendah' },
  { max: 30.0, hex: '#f1c40f', label: 'Rendah' },
  { max: 50.0, hex: '#e67e22', label: 'Sedang' },
  { max: 75.0, hex: '#e74c3c', label: 'Tinggi' },
  { max: Infinity, hex: '#78281f', label: 'Kritis' }
];

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam
const LOCK_TIMEOUT_MS = 30000; // 30 detik

// ============================================================
// HELPER: SPREADSHEET ACCESS
// ============================================================

/**
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet() {
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID belum diset. Jalankan setupSheets() atau set property manual.');
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * @param {string} sheetName
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" tidak ditemukan. Jalankan setupSheets().`);
  }
  return sheet;
}

/**
 * @returns {GoogleAppsScript.Drive.Folder}
 */
function getDriveFolder() {
  if (!DRIVE_FOLDER_ID) {
    throw new Error('DRIVE_FOLDER_ID belum diset. Jalankan setupSheets() untuk auto-create folder.');
  }
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  return folder;
}

// ============================================================
// SETUP & INITIALISASI (Phase 1.1)
// ============================================================

/**
 * Auto-create 4 sheet + header + default admin + Drive folder
 * Jalankan sekali via menu "Setup Awal" atau manual di Apps Script editor
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scriptProps = PropertiesService.getScriptProperties();

  // Set SPREADSHEET_ID property
  scriptProps.setProperty('SPREADSHEET_ID', ss.getId());

  // 1. Raw_Laporan
  let sheet = ss.getSheetByName(SHEET_NAMES.RAW_LAPORAN);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.RAW_LAPORAN);
  } else {
    sheet.clear();
  }
  sheet.appendRow([
    'ID_Laporan', 'Timestamp', 'ID_Relawan', 'ID_Desa',
    'Kategori_Infra', 'Tingkat_Kerusakan', 'Latitude', 'Longitude',
    'Foto_Bukti', 'Status_Validasi', 'Validator_ID', 'Waktu_Validasi'
  ]);
  sheet.setFrozenRows(1);

  // 2. Master_Desa
  sheet = ss.getSheetByName(SHEET_NAMES.MASTER_DESA);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.MASTER_DESA);
  } else {
    sheet.clear();
  }
  sheet.appendRow([
    'ID_Desa', 'Nama_Desa', 'Nama_Kecamatan', 'Total_Bangunan', 'Total_Penduduk'
  ]);
  sheet.setFrozenRows(1);

  // 3. Master_User
  sheet = ss.getSheetByName(SHEET_NAMES.MASTER_USER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.MASTER_USER);
  } else {
    sheet.clear();
  }
  sheet.appendRow([
    'ID_User', 'Username', 'Password_Hash', 'Nama', 'Role',
    'Afiliasi', 'Kontak', 'Status_Aktif', 'Last_Login'
  ]);
  sheet.setFrozenRows(1);

  // Default admin: admin / admin123 (hash akan digenerate)
  const defaultAdmin = {
    id: 'ADM-01',
    username: 'admin',
    password: 'admin123',
    name: 'Admin Posko Default',
    role: USER_ROLES.ADMIN_POSKO,
    afiliasi: 'BPBD',
    kontak: '081234567890',
    status: 'Aktif'
  };
  addUser(defaultAdmin);

  // Sample relawan
  const sampleRelawan = {
    id: 'REL-001',
    username: 'relawan1',
    password: 'relawan123',
    name: 'Relawan Sample',
    role: USER_ROLES.RELAWAN,
    afiliasi: 'PMI',
    kontak: '081234567891',
    status: 'Aktif'
  };
  addUser(sampleRelawan);

  // 4. Cache_Choropleth
  sheet = ss.getSheetByName(SHEET_NAMES.CACHE_CHOROPLETH);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.CACHE_CHOROPLETH);
  } else {
    sheet.clear();
  }
  sheet.appendRow([
    'ID_Desa', 'Nama_Desa', 'Total_Bangunan',
    'Total_Laporan_Valid', 'Rusak_Berat', 'Rusak_Sedang', 'Rusak_Ringan',
    'Skor_Damage', 'Warna_Hex', 'Last_Updated'
  ]);
  sheet.setFrozenRows(1);

  // Drive folder untuk foto
  const folderName = 'Awastha_Foto_Laporan';
  const folders = DriveApp.getFoldersByName(folderName);
  let folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
  }
  scriptProps.setProperty('DRIVE_FOLDER_ID', folder.getId());

  try {
    SpreadsheetApp.getUi().alert('Setup selesai! 4 sheet + folder Drive dibuat. Admin default: admin / admin123');
  } catch (e) {
    console.log('UI alert skipped: running outside spreadsheet context');
  }
}

/**
 * Tambah user ke Master_User (hash password)
 * @param {Object} user - {id, username, password, name, role, afiliasi, kontak, status}
 */
function addUser(user) {
  const sheet = getSheet(SHEET_NAMES.MASTER_USER);
  const salt = generateSalt();
  const hash = hashPassword(user.password, salt);
  const storedHash = hash + ':' + salt; // format "hash:salt"
  sheet.appendRow([
    user.id, user.username, storedHash, user.name, user.role,
    user.afiliasi, user.kontak, user.status, ''
  ]);
  return { id: user.id };
}

/**
 * @returns {string} 16-char random salt
 */
function generateSalt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  for (let i = 0; i < 16; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

/**
 * Menu onOpen
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Awastha Setup')
    .addItem('🔧 Setup Awal (Jalankan Sekali)', 'setupSheets')
    .addItem('⏱️ Install Trigger Agregasi (5 menit)', 'installTriggers')
    .addToUi();
}

// ============================================================
// AUTH ENGINE: SHA-256 + Salt + Session (Phase 1.2)
// ============================================================

/**
 * Hash password dengan SHA-256 + Salt
 * @param {string} password - plaintext password
 * @param {string} salt - 16-char salt
 * @returns {string} hex string 64 chars
 */
function hashPassword(password, salt) {
  const rawHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + salt,
    Utilities.Charset.UTF_8
  );
  let output = '';
  for (let i = 0; i < rawHash.length; i++) {
    let byteValue = rawHash[i];
    if (byteValue < 0) byteValue += 256;
    let byteString = byteValue.toString(16);
    if (byteString.length === 1) byteString = '0' + byteString;
    output += byteString;
  }
  return output;
}

/**
 * Verifikasi password plaintext terhadap hash+ salt yang tersimpan
 * Format hash tersimpan: "hash:salt" (64+1+16=81 chars)
 * @param {string} passwordPlain
 * @param {string} storedHash - format "hash:salt"
 * @returns {boolean}
 */
function verifyPassword(passwordPlain, storedHash) {
  if (!storedHash || storedHash.indexOf(':') === -1) return false;
  const [hash, salt] = storedHash.split(':');
  const computedHash = hashPassword(passwordPlain, salt);
  return computedHash === hash;
}

/**
 * Generate session token & simpan ke CacheService
 * @param {string} userId
 * @returns {string} token
 */
function generateSessionToken(userId) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  const payload = JSON.stringify({ userId: userId, created: Date.now() });
  cache.put('session_' + token, payload, 28800); // 8 jam dalam detik
  return token;
}

/**
 * Verifikasi session token
 * @param {string} token
 * @returns {Object|null} {userId} atau null jika invalid
 */
function verifySessionToken(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const payload = cache.get('session_' + token);
  if (!payload) return null;
  try {
    const data = JSON.parse(payload);
    // Cek TTL manual (CacheService auto-expire tapi double-check)
    if (Date.now() - data.created > SESSION_TTL_MS) {
      cache.remove('session_' + token);
      return null;
    }
    return { userId: data.userId };
  } catch (e) {
    return null;
  }
}

/**
 * Login admin/validator
 * @param {string} username
 * @param {string} passwordPlain
 * @returns {Object} {success: boolean, token?: string, user?: Object, error?: string}
 */
function authenticateAdmin(username, passwordPlain) {
  const sheet = getSheet(SHEET_NAMES.MASTER_USER);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const [id, uname, storedHash, name, role, afiliasi, kontak, status, lastLogin] = row;
    
    if (uname === username && status === 'Aktif' && 
        (role === USER_ROLES.ADMIN_POSKO || role === USER_ROLES.VALIDATOR)) {
      if (verifyPassword(passwordPlain, storedHash)) {
        // Update Last_Login
        sheet.getRange(i + 1, 9).setValue(new Date());
        
        const token = generateSessionToken(id);
        return {
          success: true,
          token: token,
          user: { id, username: uname, name, role, afiliasi }
        };
      }
      return { success: false, error: 'Password salah' };
    }
  }
  return { success: false, error: 'User tidak ditemukan atau bukan admin/validator' };
}

/**
 * Logout / hapus session token
 * @param {string} token
 */
function logoutAdmin(token) {
  const cache = CacheService.getScriptCache();
  cache.remove('session_' + token);
}

// ============================================================
// DRIVE PHOTO UPLOAD (Phase 1.3)
// ============================================================

/**
 * Upload foto Base64 ke Google Drive
 * @param {string} base64Data - Base64 string (tanpa prefix data:image/...)
 * @param {string} fileName - nama file, misal "laporan_<uuid>.jpg"
 * @returns {string} public URL file
 */
function uploadPhotoToDrive(base64Data, fileName) {
  const folder = getDriveFolder();
  
  // Decode base64
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', fileName);
  
  // Create file
  const file = folder.createFile(blob);
  
  // Set sharing: Anyone with link can view
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  // Return direct image URL (thumbnail atau direct link)
  // Format: https://drive.google.com/uc?id=FILE_ID
  return 'https://drive.google.com/uc?id=' + file.getId();
}

// ============================================================
// REPORT SUBMISSION (Phase 1.4)
// ============================================================

/**
 * Validasi ID_Relawan di Master_User
 * @param {string} idRelawan
 * @returns {boolean}
 */
function validateRelawan(idRelawan) {
  const sheet = getSheet(SHEET_NAMES.MASTER_USER);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues(); // skip header
  
  for (const row of data) {
    const [id, , , , role, , , status] = row;
    if (id === idRelawan && role === USER_ROLES.RELAWAN && status === 'Aktif') {
      return true;
    }
  }
  return false;
}

/**
 * Validasi ID_Desa di Master_Desa
 * @param {string} idDesa
 * @returns {boolean}
 */
function validateDesa(idDesa) {
  const sheet = getSheet(SHEET_NAMES.MASTER_DESA);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  return data.some(row => row[0] === idDesa);
}

/**
 * Submit laporan kerusakan dari relawan
 * @param {Object} formData - { idRelawan, idDesa, kategoriInfra, tingkatKerusakan, latitude, longitude, fotoBase64 }
 * @returns {Object} {success: boolean, idLaporan?: string, error?: string}
 */
function processReportSubmit(formData) {
  // Validasi input
  if (!formData.idRelawan || !formData.idDesa || !formData.kategoriInfra || 
      !formData.tingkatKerusakan || !formData.latitude || !formData.longitude) {
    return { success: false, error: 'Field wajib tidak lengkap' };
  }
  
  if (!INFRA_CATEGORIES.includes(formData.kategoriInfra)) {
    return { success: false, error: 'Kategori infrastruktur tidak valid' };
  }
  if (!DAMAGE_LEVELS.includes(formData.tingkatKerusakan)) {
    return { success: false, error: 'Tingkat kerusakan tidak valid' };
  }
  if (!validateRelawan(formData.idRelawan)) {
    return { success: false, error: 'ID Relawan tidak valid atau nonaktif' };
  }
  if (!validateDesa(formData.idDesa)) {
    return { success: false, error: 'ID Desa tidak valid' };
  }
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    
    const sheet = getSheet(SHEET_NAMES.RAW_LAPORAN);
    const idLaporan = Utilities.getUuid();
    const timestamp = new Date();
    
    // Upload foto jika ada
    let fotoUrl = '';
    if (formData.fotoBase64) {
      const fileName = 'laporan_' + idLaporan + '.jpg';
      fotoUrl = uploadPhotoToDrive(formData.fotoBase64, fileName);
    }
    
    // Append row
    sheet.appendRow([
      idLaporan,
      timestamp,
      formData.idRelawan,
      formData.idDesa,
      formData.kategoriInfra,
      formData.tingkatKerusakan,
      parseFloat(formData.latitude),
      parseFloat(formData.longitude),
      fotoUrl,
      REPORT_STATUS.MENUNGGU,
      '', // Validator_ID
      ''  // Waktu_Validasi
    ]);
    
    return { success: true, idLaporan: idLaporan, fotoUrl: fotoUrl };
    
  } catch (e) {
    return { success: false, error: 'Gagal menyimpan: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// HTML SERVICE HELPERS (Phase 4 prep)
// ============================================================

/**
 * Include HTML file untuk templating
 * @param {string} filename - tanpa ekstensi .html
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Entry point web app
 * @param {Object} e - event object
 * @returns {HtmlOutput}
 */
function doGet(e) {
  const action = e?.parameter?.action;
  
  if (action === 'getChoropleth') {
    return getChoroplethDataApi();
  }
  
  // Serve SPA
  const template = HtmlService.createTemplateFromFile('index');
  template.include = include;
  return template.evaluate()
    .setTitle('Peta Kerusakan Infrastruktur - Awastha')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Get choropleth data dari cache (plain object untuk google.script.run)
 * @returns {Array<Object>}
 */
function getChoroplethData() {
  const sheet = getSheet(SHEET_NAMES.CACHE_CHOROPLETH);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);
  
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

/**
 * REST API: Get choropleth data dari cache (endpoint /exec?action=getChoropleth)
 * @returns {ContentService.TextOutput} JSON
 */
function getChoroplethDataApi() {
  return jsonOutput(getChoroplethData());
}

// ============================================================
// ADMIN MODERATION (Phase 2)
// ============================================================

/**
 * Get semua laporan pending (Status=Menunggu) untuk dashboard admin
 * @param {string} token - session token
 * @returns {Object} {success, reports?, error?}
 */
function getPendingReports(token) {
  const session = verifySessionToken(token);
  if (!session) return { success: false, error: 'Token tidak valid' };
  
  const sheet = getSheet(SHEET_NAMES.RAW_LAPORAN);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const reports = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const statusIdx = headers.indexOf('Status_Validasi');
    if (row[statusIdx] === REPORT_STATUS.MENUNGGU) {
      const obj = { _rowIndex: i + 1 }; // 1-based sheet row
      headers.forEach((h, j) => obj[h] = row[j]);
      reports.push(obj);
    }
  }
  return { success: true, reports: reports };
}

/**
 * Get semua laporan untuk dashboard admin (protected)
 * @param {string} token
 * @returns {Object}
 */
function getAllReportsForModeration(token) {
  const session = verifySessionToken(token);
  if (!session) return { success: false, error: 'Token tidak valid' };
  
  const sheet = getSheet(SHEET_NAMES.RAW_LAPORAN);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const reports = data.slice(1).map((row, i) => {
    const obj = { _rowIndex: i + 2 };
    headers.forEach((h, j) => obj[h] = row[j]);
    return obj;
  });
  return { success: true, reports: reports };
}

/**
 * Update status validasi laporan (approve/tolak) dengan audit trail
 * @param {string} token - session token
 * @param {string} idLaporan - ID_Laporan UUID
 * @param {string} newStatus - 'Valid' atau 'Ditolak'
 * @returns {Object} {success, error?}
 */
function updateValidationStatus(token, idLaporan, newStatus) {
  const session = verifySessionToken(token);
  if (!session) return { success: false, error: 'Token tidak valid' };
  
  if (newStatus !== REPORT_STATUS.VALID && newStatus !== REPORT_STATUS.DITOLAK) {
    return { success: false, error: 'Status tidak valid. Gunakan "Valid" atau "Ditolak"' };
  }
  
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    
    const sheet = getSheet(SHEET_NAMES.RAW_LAPORAN);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('ID_Laporan');
    const statusIdx = headers.indexOf('Status_Validasi');
    const validatorIdx = headers.indexOf('Validator_ID');
    const waktuIdx = headers.indexOf('Waktu_Validasi');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === idLaporan) {
        const rowNum = i + 1;
        sheet.getRange(rowNum, statusIdx + 1).setValue(newStatus);
        sheet.getRange(rowNum, validatorIdx + 1).setValue(session.userId);
        sheet.getRange(rowNum, waktuIdx + 1).setValue(new Date());
        return { success: true, idLaporan: idLaporan, newStatus: newStatus };
      }
    }
    return { success: false, error: 'Laporan tidak ditemukan' };
  } catch (e) {
    return { success: false, error: 'Gagal update: ' + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Get daftar desa untuk dropdown form relawan
 * @returns {Object} {success, desaList?}
 */
function getDesaList() {
  const sheet = getSheet(SHEET_NAMES.MASTER_DESA);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const desaList = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  return { success: true, desaList: desaList };
}

// ============================================================
// REST API: doPost (Phase 2)
// ============================================================

/**
 * REST POST endpoint untuk submit laporan alternatif
 * Body: JSON { action: 'submitReport', data: {...} }
 * @param {Object} e
 * @returns {ContentService.TextOutput} JSON
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    
    if (body.action === 'submitReport') {
      const result = processReportSubmit(body.data);
      return jsonOutput(result);
    }
    
    if (body.action === 'updateStatus') {
      const result = updateValidationStatus(body.token, body.idLaporan, body.newStatus);
      return jsonOutput(result);
    }
    
    return jsonOutput({ success: false, error: 'Action tidak dikenali' });
  } catch (err) {
    return jsonOutput({ success: false, error: err.toString() });
  }
}

/**
 * Helper: return JSON ContentService output
 * @param {Object} obj
 * @returns {ContentService.TextOutput}
 */
function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// AGREGASI & SCORING (Phase 3)
// ============================================================

/**
 * Hitung skor damage dan tentukan warna hex
 * @param {number} skor - 0-100
 * @returns {string} hex color
 */
function getDamageColorHex(skor) {
  for (const tier of COLOR_THRESHOLDS) {
    if (skor <= tier.max) return tier.hex;
  }
  return COLOR_THRESHOLDS[COLOR_THRESHOLDS.length - 1].hex;
}

/**
 * Agregasi data laporan valid → Cache_Choropleth
 * Jalankan via time-driven trigger setiap 5 menit
 */
function aggregateChoroplethData() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
    
    const rawSheet = getSheet(SHEET_NAMES.RAW_LAPORAN);
    const desaSheet = getSheet(SHEET_NAMES.MASTER_DESA);
    const cacheSheet = getSheet(SHEET_NAMES.CACHE_CHOROPLETH);
    
    // Load Master_Desa
    const desaData = desaSheet.getDataRange().getValues();
    const desaHeaders = desaData[0];
    const desaMap = {};
    for (let i = 1; i < desaData.length; i++) {
      const row = desaData[i];
      const idIdx = desaHeaders.indexOf('ID_Desa');
      const namaIdx = desaHeaders.indexOf('Nama_Desa');
      const bangunanIdx = desaHeaders.indexOf('Total_Bangunan');
      desaMap[row[idIdx]] = {
        namaDesa: row[namaIdx],
        totalBangunan: row[bangunanIdx] || 0,
        rusakBerat: 0,
        rusakSedang: 0,
        rusakRingan: 0,
        totalLaporan: 0
      };
    }
    
    // Load Raw_Laporan, filter Valid
    const rawData = rawSheet.getDataRange().getValues();
    const rawHeaders = rawData[0];
    const idDesaIdx = rawHeaders.indexOf('ID_Desa');
    const tingkatIdx = rawHeaders.indexOf('Tingkat_Kerusakan');
    const statusIdx = rawHeaders.indexOf('Status_Validasi');
    
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (row[statusIdx] !== REPORT_STATUS.VALID) continue;
      
      const idDesa = row[idDesaIdx];
      const tingkat = row[tingkatIdx];
      
      if (!desaMap[idDesa]) continue;
      
      desaMap[idDesa].totalLaporan++;
      if (tingkat === 'Berat') desaMap[idDesa].rusakBerat++;
      else if (tingkat === 'Sedang') desaMap[idDesa].rusakSedang++;
      else if (tingkat === 'Ringan') desaMap[idDesa].rusakRingan++;
    }
    
    // Clear cache sheet & rewrite
    cacheSheet.getRange(2, 1, cacheSheet.getLastRow() - 1 || 1, 10).clearContent();
    
    const now = new Date();
    let rowIdx = 2;
    
    for (const idDesa in desaMap) {
      const d = desaMap[idDesa];
      const totalBangunan = d.totalBangunan || 1; // hindari div0
      const skor = ((WEIGHTS.BERAT * d.rusakBerat + 
                     WEIGHTS.SEDANG * d.rusakSedang + 
                     WEIGHTS.RINGAN * d.rusakRingan) / totalBangunan) * 100;
      const warna = getDamageColorHex(skor);
      
      cacheSheet.getRange(rowIdx, 1, 1, 10).setValues([[
        idDesa,
        d.namaDesa,
        d.totalBangunan,
        d.totalLaporan,
        d.rusakBerat,
        d.rusakSedang,
        d.rusakRingan,
        Math.round(skor * 100) / 100, // 2 decimal
        warna,
        now
      ]]);
      rowIdx++;
    }
    
    return { success: true, desaCount: rowIdx - 2 };
  } catch (e) {
    console.error('aggregateChoroplethData error: ' + e.toString());
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// TIME-DRIVEN TRIGGERS (Phase 3)
// ============================================================

/**
 * Install time-driven trigger setiap 5 menit untuk aggregateChoroplethData
 */
function installTriggers() {
  // Hapus trigger lama dengan nama fungsi sama
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'aggregateChoroplethData') {
      ScriptApp.deleteTrigger(t);
    }
  }
  
  ScriptApp.newTrigger('aggregateChoroplethData')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  SpreadsheetApp.getUi().alert('Trigger agregasi 5 menit terpasang!');
}

/**
 * Hapus semua trigger agregasi
 */
function uninstallTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'aggregateChoroplethData') {
      ScriptApp.deleteTrigger(t);
    }
  }
  SpreadsheetApp.getUi().alert('Trigger agregasi dihapus!');
}
