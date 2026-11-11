/* =====================================================================
 * Poster Logistics — เฟส ก: Config + ตัวช่วยชีต (colmap/วันที่/lock/Log) + สิทธิ์ + setupSheets
 * ไฟล์นี้อยู่คู่กับ Code.gs ในโปรเจกต์เดียวกัน ชื่อทุกตัวในไฟล์นี้ไม่ชนกับของ Code.gs
 * กติกา: ไม่แตะคอลัมน์เดิม A–AP · หาคอลัมน์จากชื่อหัว (แถว 4) เสมอ · ทุกการเขียนผ่าน lock และลง Log
 * ===================================================================== */

var PL_REAL_SPREADSHEET_ID_ = "YOUR_REAL_SPREADSHEET_ID";   // ใส่รหัสชีตจริงก่อน push ขึ้น Apps Script (ไม่เก็บใน repo สาธารณะ)

var Config = {
  SPREADSHEET_ID: PL_REAL_SPREADSHEET_ID_,
  SHEET_JOBS: "2026",
  SHEET_TRANSPORT: "Transpot & Supplier",
  SHEET_TEAM: "ความรับผิดชอบทีม",
  SHEET_USERS: "Users",
  SHEET_LOG: "Log",
  HEADER_ROW: 4,          // หัวตารางแถว 4 (นับแบบชีต เริ่ม 1)
  DATA_START_ROW: 5,
  TZ: "Asia/Bangkok",
  DATE_FORMAT: "d-MMM-yyyy",   // รูปแบบเดียวกับวันที่ที่มีอยู่ในชีต เช่น 12-Nov-2026
  DEFAULT_BUFFER_DAYS: 2,
  SLA_WORKDAYS: 3,
  GO_LIVE_MONTH: "2026-11",    // แถวเดือนก่อนหน้านี้ ระบบไม่แตะ (รวมคอลัมน์ B)
  LOCK_WAIT_MS: 20000,
  USERS_CACHE_SECONDS: 120,

  ROLES: ["AE", "Ops", "Production", "MA", "Installer", "Admin"],
  STATUS: {
    WAIT_OPS: "รอ Ops รับงาน",
    WAIT_AE: "รอ AE รับทราบ",
    SCHEDULED: "มีกำหนด",
    SHIPPED: "ส่งแล้ว",
    RESHIP: "รอส่งใหม่",
    RECEIVED: "รับของแล้ว",
    INSTALLED: "ติดตั้งแล้ว",
    INSTALLED_MANUAL: "ติดตั้งแล้ว (ยืนยันมือ)",
    ON_AIR: "On air",
    CLOSED: "ปิดงาน (ส่ง Proof แล้ว)"
  },
  CONDITIONS: ["ครบ", "เสียหาย"],
  INSTALL_TEAMS: ["Operation", "Supplier", "UPC 2", "Project"],   // "Project" มีใช้อยู่แล้วในชีต 2026

  // หัวคอลัมน์เดิมที่ระบบนี้ใช้ (แท็บ 2026) — ถ้าหัวไหนหาย getColMap_ จะ throw
  JOB_COLS: {
    STATUS_B: "Status", YEAR: "Year", MONTH: "Month", SIGN: "ตำแหน่งป้าย", IATA: "IATA",
    SHIP_TO: "การจัดส่ง / สถานที่รับงาน", RECEIVER: "ผู้รับและเบอร์โทร",
    SHIP_DATE: "วันที่จัดส่ง Poster", INSTALL_DATE: "วันที่ติดตั้ง Poster", AD_ON: "ad release",
    TEAM: "ทีมติดตั้ง", REMARK: "Remark"
  },
  // คอลัมน์ใหม่ (ต่อท้ายทางขวา AQ–BC) เรียงตามลำดับนี้
  NEW_JOB_COLS: {
    JOB_STATUS: "สถานะงาน", CONFIRMED_BY: "ยืนยันกำหนดการโดย", CONFIRMED_AT: "ยืนยันกำหนดการเมื่อ",
    REASON: "เหตุผล", SHIPPED_AT: "ส่งจริงเมื่อ", TRACKING: "ขนส่ง / เลขพัสดุ", RECEIVED_AT: "รับของเมื่อ",
    CONDITION: "สภาพของ", INSTALLED_AT: "ติดตั้งจริงเมื่อ", PHOTOS: "รูปติดตั้ง", PROOF_AT: "ส่ง Proof เมื่อ",
    UPDATED_BY: "แก้ล่าสุดโดย", UPDATED_AT: "แก้ล่าสุดเมื่อ"
  },
  TRANSPORT_COLS: { IATA: "IATA", REMARK: "Remark" },
  NEW_TRANSPORT_COLS: { SHIP_TO: "จุดรับของ (default)", RECEIVER: "ผู้รับ", PHONE: "เบอร์ผู้รับ", BUFFER: "Buffer (วัน)" },
  USERS_HEADERS: ["email", "ชื่อ", "บทบาท"],
  LOG_HEADERS: ["เวลา", "email", "แถว", "ตำแหน่งป้าย", "คอลัมน์", "ค่าเดิม", "ค่าใหม่", "action"],

  // วันหยุดที่ไม่นับเป็นวันทำการ (yyyy-MM-dd) — ใส่เฉพาะวันที่ตายตัว
  // วันพระ (มาฆะ/วิสาขะ/อาสาฬหะ/เข้าพรรษา) และวันหยุดชดเชย ต้องเติมเองตามประกาศแต่ละปี
  HOLIDAYS: [
    "2026-12-05", "2026-12-10", "2026-12-31",
    "2027-01-01", "2027-04-06", "2027-04-13", "2027-04-14", "2027-04-15", "2027-05-01", "2027-05-04",
    "2027-06-03", "2027-07-28", "2027-08-12", "2027-10-13", "2027-10-23", "2027-12-05", "2027-12-10", "2027-12-31"
  ],

  // ค่าลับ/ค่าที่เปลี่ยนตามสภาพแวดล้อม เก็บใน Script Properties (Project Settings > Script properties)
  //   PHOTO_FOLDER_ID = โฟลเดอร์ Drive เก็บรูปติดตั้ง · OPS_HEAD_EMAIL = หัวหน้า Ops รับแจ้ง SLA
  prop: function (key) {
    return PropertiesService.getScriptProperties().getProperty(key) || "";
  }
};

/* ---------------------------------------------------------------------
 * ชีต & คอลัมน์
 * ------------------------------------------------------------------- */

// เปิดชีตครั้งเดียวต่อการเรียก 1 ครั้ง (openById ช้า) · ถ้าตั้ง Script Property PL_UI_TEST_SPREADSHEET_ID
// ระบบ Poster Logistics จะอ่าน/เขียนสำเนาชีตนั้นแทน (ใช้ทดสอบหน้าจอผ่าน /dev) — ต้องลบออกก่อน deploy จริง
var PL_SS_CACHE_ = {};
function plSpreadsheetId_() {
  if (Config.SPREADSHEET_ID !== PL_REAL_SPREADSHEET_ID_) return Config.SPREADSHEET_ID;   // ชุดทดสอบตั้งค่าเอง
  if (plSpreadsheetId_.ov == null) {
    plSpreadsheetId_.ov = PropertiesService.getScriptProperties().getProperty("PL_UI_TEST_SPREADSHEET_ID") || "";
  }
  return plSpreadsheetId_.ov || Config.SPREADSHEET_ID;
}
function plIsTestMode_() { return plSpreadsheetId_() !== PL_REAL_SPREADSHEET_ID_; }
function plSpreadsheet_() {
  var id = plSpreadsheetId_();
  if (!PL_SS_CACHE_[id]) PL_SS_CACHE_[id] = SpreadsheetApp.openById(id);
  return PL_SS_CACHE_[id];
}

function plSheet_(name) {
  var sh = plSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error("ไม่พบแท็บ \"" + name + "\" ในชีต");
  return sh;
}

function plNormHeader_(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

// คืน { "ชื่อหัว": index เริ่ม 0 } จากแถวหัวตาราง · หัวซ้ำตัวที่ 2 ขึ้นไปเก็บเป็น "ชื่อ#2", "ชื่อ#3"
// requiredNames (ไม่บังคับ) = รายชื่อหัวที่ต้องมี ถ้าขาดจะ throw บอกชื่อหัวที่หาย
function getColMap_(sheet, requiredNames, headerRow) {
  var hr = headerRow || Config.HEADER_ROW;
  var lastCol = sheet.getLastColumn();
  var heads = lastCol > 0 ? sheet.getRange(hr, 1, 1, lastCol).getDisplayValues()[0] : [];
  var map = {};
  for (var i = 0; i < heads.length; i++) {
    var h = plNormHeader_(heads[i]);
    if (!h) continue;
    if (!(h in map)) { map[h] = i; continue; }
    var n = 2;
    while ((h + "#" + n) in map) n++;
    map[h + "#" + n] = i;
  }
  var missing = [];
  (requiredNames || []).forEach(function (name) {
    if (!(plNormHeader_(name) in map)) missing.push(name);
  });
  if (missing.length) {
    throw new Error("แท็บ \"" + sheet.getName() + "\" ไม่พบหัวคอลัมน์ (แถว " + hr + "): " + missing.join(", "));
  }
  return map;
}

function plValues_(obj) {
  return Object.keys(obj).map(function (k) { return obj[k]; });
}

/* ---------------------------------------------------------------------
 * วันที่ — ในชีตมีทั้ง Date จริง, ข้อความ 12-Nov-2026, 12/31/2026, ว่าง
 * parseDate_ ไม่ throw: แปลงไม่ได้คืน null · วันที่ที่คืนตั้งเวลาเที่ยงวัน กันวันเลื่อนจากเขตเวลา
 * ------------------------------------------------------------------- */

var PL_MONTHS_ = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, sept: 8,
  october: 9, november: 10, december: 11,
  "ม.ค.": 0, "ก.พ.": 1, "มี.ค.": 2, "เม.ย.": 3, "พ.ค.": 4, "มิ.ย.": 5,
  "ก.ค.": 6, "ส.ค.": 7, "ก.ย.": 8, "ต.ค.": 9, "พ.ย.": 10, "ธ.ค.": 11,
  "มกราคม": 0, "กุมภาพันธ์": 1, "มีนาคม": 2, "เมษายน": 3, "พฤษภาคม": 4, "มิถุนายน": 5,
  "กรกฎาคม": 6, "สิงหาคม": 7, "กันยายน": 8, "ตุลาคม": 9, "พฤศจิกายน": 10, "ธันวาคม": 11
};

function plMakeDate_(y, m, d) {
  if (y >= 2400) y -= 543;                 // ปี พ.ศ.
  if (y < 100) y += 2000;
  if (!(y >= 2000 && y <= 2100) || !(m >= 0 && m <= 11) || !(d >= 1 && d <= 31)) return null;
  var dt = new Date(y, m, d, 12, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null; // 31-Feb ฯลฯ
  return dt;
}

function parseDate_(v) {
  try {
    if (v == null || v === "") return null;
    if (Object.prototype.toString.call(v) === "[object Date]") {
      if (isNaN(v.getTime())) return null;
      var parts = Utilities.formatDate(v, Config.TZ, "yyyy-M-d").split("-");
      return plMakeDate_(+parts[0], +parts[1] - 1, +parts[2]);
    }
    if (typeof v === "number") {            // เลขวันแบบชีต (นับจาก 30-Dec-1899)
      if (v < 20000 || v > 80000) return null;
      var base = new Date(1899, 11, 30, 12, 0, 0);
      base.setDate(base.getDate() + Math.floor(v));
      return plMakeDate_(base.getFullYear(), base.getMonth(), base.getDate());
    }
    var s = String(v).trim();
    if (!s) return null;
    var m;
    // 2026-11-12 หรือ 2026/11/12 (อาจมีเวลาต่อท้าย)
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:\D|$)/))) return plMakeDate_(+m[1], +m[2] - 1, +m[3]);
    // 12-Nov-2026, 12 Nov 2026, 12 พ.ย. 2569
    // (มีเวลาต่อท้ายได้ เช่น 12-Nov-2026 18:30 ที่ระบบเขียนในคอลัมน์ "...เมื่อ")
    if ((m = s.match(/^(\d{1,2})[\s\-\/]*([A-Za-z]+\.?|[฀-๿.]+)[\s\-\/,]*(\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/))) {
      var mon = PL_MONTHS_[m[2].toLowerCase()];
      if (mon == null) mon = PL_MONTHS_[m[2].toLowerCase().replace(/\.$/, "")];
      return mon == null ? null : plMakeDate_(+m[3], mon, +m[1]);
    }
    // Nov 12, 2026
    if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/))) {
      var mon2 = PL_MONTHS_[m[1].toLowerCase()];
      return mon2 == null ? null : plMakeDate_(+m[3], mon2, +m[2]);
    }
    // 12/31/2026 (เดือน/วัน/ปี แบบที่ชีตใช้) · ถ้าตัวแรกเกิน 12 ถือเป็น วัน/เดือน/ปี
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
      var a = +m[1], b = +m[2];
      return a > 12 ? plMakeDate_(+m[3], b - 1, a) : plMakeDate_(+m[3], a - 1, b);
    }
    return null;
  } catch (e) {
    return null;
  }
}

// เขียนกลับเป็นข้อความรูปแบบเดิมของชีต เช่น 12-Nov-2026 · ค่าว่าง/แปลงไม่ได้ คืน ""
function formatDate_(v) {
  var d = parseDate_(v);
  return d ? Utilities.formatDate(d, Config.TZ, Config.DATE_FORMAT) : "";
}

function plDateKey_(v) {
  var d = parseDate_(v);
  return d ? Utilities.formatDate(d, Config.TZ, "yyyy-MM-dd") : "";
}

function plAddDays_(v, n) {
  var d = parseDate_(v);
  if (!d) return null;
  return plMakeDate_(d.getFullYear(), d.getMonth(), d.getDate() + n) ||
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0);
}

function plIsWorkday_(v) {
  var d = parseDate_(v);
  if (!d) return false;
  var dow = d.getDay();
  return dow !== 0 && dow !== 6 && Config.HOLIDAYS.indexOf(plDateKey_(d)) < 0;
}

// นับวันทำการหลังวันเริ่มไป n วัน (ไม่นับวันเริ่ม)
function plAddWorkdays_(v, n) {
  var d = parseDate_(v);
  if (!d) return null;
  var left = n;
  while (left > 0) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0);
    if (plIsWorkday_(d)) left--;
  }
  return d;
}

// เวลาปัจจุบันแบบละเอียดถึงมิลลิวินาที ใช้เป็น version token ใน "แก้ล่าสุดเมื่อ"
function plNowToken_() {
  return Utilities.formatDate(new Date(), Config.TZ, "yyyy-MM-dd HH:mm:ss.SSS");
}

/* ---------------------------------------------------------------------
 * Lock & Log
 * ------------------------------------------------------------------- */

// รัน fn ภายใต้ script lock เดียวกันทั้งระบบ · รอไม่ได้ → throw BUSY
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(Config.LOCK_WAIT_MS)) {
    var err = new Error("BUSY: มีคนกำลังบันทึกอยู่ ลองใหม่อีกครั้งในไม่กี่วินาที");
    err.code = "BUSY";
    throw err;
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// entries: [{ email, row, sign, col, oldVal, newVal, action }] — เขียนทีเดียวต่อท้ายแท็บ Log
// เรียกภายใน withLock_ เท่านั้น (ไม่ล็อกซ้ำเอง)
function appendLog_(entries) {
  if (!entries || !entries.length) return 0;
  var sh = plSheet_(Config.SHEET_LOG);
  var ts = Utilities.formatDate(new Date(), Config.TZ, "yyyy-MM-dd HH:mm:ss");
  var rows = entries.map(function (e) {
    return [ts, e.email || "", e.row || "", e.sign || "", e.col || "",
      plLogVal_(e.oldVal), plLogVal_(e.newVal), e.action || ""];
  });
  var start = sh.getLastRow() + 1;
  if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 100);
  var rg = sh.getRange(start, 1, rows.length, Config.LOG_HEADERS.length);
  rg.setNumberFormat("@");
  rg.setValues(rows);
  return rows.length;
}

function plLogVal_(v) {
  if (v == null) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") return formatDate_(v);
  return String(v);
}

/* ---------------------------------------------------------------------
 * สิทธิ์ — ตรวจฝั่ง server เสมอ อ่านจากแท็บ Users (email | ชื่อ | บทบาท)
 * ------------------------------------------------------------------- */

function plUsers_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("pl_users_v1");
  if (hit) return JSON.parse(hit);
  var sh = plSheet_(Config.SHEET_USERS);
  var last = sh.getLastRow();
  var out = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getDisplayValues().forEach(function (r) {
      var email = String(r[0] || "").trim().toLowerCase();
      var role = String(r[2] || "").trim();
      if (!email || Config.ROLES.indexOf(role) < 0) return;
      out[email] = { name: String(r[1] || "").trim(), role: role };
    });
  }
  cache.put("pl_users_v1", JSON.stringify(out), Config.USERS_CACHE_SECONDS);
  return out;
}

function plClearUsersCache() {
  CacheService.getScriptCache().remove("pl_users_v1");
}

// ผู้ใช้ที่เปิดหน้าเว็บอยู่ · ไม่มีใน Users = role "" (ดูได้อย่างเดียว)
function plCurrentUser_() {
  var email = "";
  try { email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase(); } catch (e) { }
  var u = email ? plUsers_()[email] : null;
  return { email: email, name: u ? u.name : "", role: u ? u.role : "" };
}

// ตรวจว่า user มีบทบาทใน roles ไหม (Admin ผ่านทุกอย่าง) · ไม่ผ่าน → throw FORBIDDEN
function requireRole_(user, roles) {
  if (!user || !user.email) {
    var e0 = new Error("FORBIDDEN: ระบบอ่านอีเมลของคุณไม่ได้ กรุณาเข้าด้วยบัญชีบริษัท");
    e0.code = "FORBIDDEN";
    throw e0;
  }
  if (user.role === "Admin" || roles.indexOf(user.role) >= 0) return true;
  var e = new Error("FORBIDDEN: บทบาท " + (user.role || "(ไม่มีในรายชื่อ Users)") + " ทำรายการนี้ไม่ได้ ต้องเป็น " + roles.join(" / "));
  e.code = "FORBIDDEN";
  throw e;
}

// เรียกจากหน้าเว็บ: บอกว่าใครเปิดอยู่และมีบทบาทอะไร
function getMyContext() {
  var u = plCurrentUser_();
  return { email: u.email, name: u.name, role: u.role, roles: Config.ROLES };
}

/* ---------------------------------------------------------------------
 * setupSheets — idempotent: รันกี่รอบก็ได้ เพิ่มเฉพาะที่ยังไม่มี ไม่เขียนทับหัวหรือข้อมูลเดิม
 * ------------------------------------------------------------------- */

function setupSheets() {
  var ss = plSpreadsheet_();
  var report = [];

  // 1) แท็บ 2026: หัวเดิมต้องครบ แล้วเติมหัวใหม่ที่ยังไม่มี
  var jobs = plSheet_(Config.SHEET_JOBS);
  getColMap_(jobs, plValues_(Config.JOB_COLS));
  report = report.concat(plEnsureHeaders_(jobs, plValues_(Config.NEW_JOB_COLS)));
  var jm = getColMap_(jobs, plValues_(Config.NEW_JOB_COLS));
  var nRows = jobs.getMaxRows() - Config.DATA_START_ROW + 1;
  var N = Config.NEW_JOB_COLS;

  // คอลัมน์ใหม่เป็นข้อความล้วน กันชีตแปลง token/วันที่เอง
  var firstNew = jm[N.JOB_STATUS] + 1, lastNew = jm[N.UPDATED_AT] + 1;
  jobs.getRange(Config.DATA_START_ROW, firstNew, nRows, lastNew - firstNew + 1).setNumberFormat("@");

  plSetListValidation_(jobs.getRange(Config.DATA_START_ROW, jm[N.JOB_STATUS] + 1, nRows, 1), plValues_(Config.STATUS), false);
  plSetListValidation_(jobs.getRange(Config.DATA_START_ROW, jm[N.CONDITION] + 1, nRows, 1), Config.CONDITIONS, false);
  // ทีมติดตั้ง (คอลัมน์เดิม): ใส่ dropdown เฉพาะเมื่อยังไม่มี validation อยู่ก่อน
  var teamCol = getColMap_(jobs)[Config.JOB_COLS.TEAM] + 1;
  if (!jobs.getRange(Config.DATA_START_ROW, teamCol).getDataValidation()) {
    plSetListValidation_(jobs.getRange(Config.DATA_START_ROW, teamCol, nRows, 1), Config.INSTALL_TEAMS, false);
    report.push("2026: ใส่ dropdown ทีมติดตั้ง");
  }

  // 2) Transpot & Supplier: เติมหัวใหม่ต่อจาก Remark
  var tr = plSheet_(Config.SHEET_TRANSPORT);
  getColMap_(tr, plValues_(Config.TRANSPORT_COLS));
  report = report.concat(plEnsureHeaders_(tr, plValues_(Config.NEW_TRANSPORT_COLS)));

  // 3) แท็บ Users / Log
  report = report.concat(plEnsureTab_(ss, Config.SHEET_USERS, Config.USERS_HEADERS));
  report = report.concat(plEnsureTab_(ss, Config.SHEET_LOG, Config.LOG_HEADERS));
  var us = plSheet_(Config.SHEET_USERS);
  plSetListValidation_(us.getRange(2, 3, us.getMaxRows() - 1, 1), Config.ROLES, true);

  if (!report.length) report.push("ครบอยู่แล้ว ไม่มีอะไรเปลี่ยน");
  Logger.log(report.join("\n"));
  return report;
}

// เติมหัวที่ยังไม่มี ต่อท้ายหัวสุดท้ายที่มีอยู่ · ไม่ย้าย/ไม่ทับหัวเดิม
function plEnsureHeaders_(sheet, names) {
  var hr = Config.HEADER_ROW;
  var map = getColMap_(sheet);
  var lastHead = -1;
  Object.keys(map).forEach(function (k) { if (map[k] > lastHead) lastHead = map[k]; });
  var missing = names.filter(function (n) { return !(plNormHeader_(n) in map); });
  if (!missing.length) return [];
  var startCol = lastHead + 2;                       // คอลัมน์ว่างถัดจากหัวสุดท้าย (เริ่ม 1)
  var endCol = startCol + missing.length - 1;
  if (endCol > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), endCol - sheet.getMaxColumns());
  var target = sheet.getRange(hr, startCol, 1, missing.length);
  var existing = target.getDisplayValues()[0].filter(function (v) { return String(v).trim() !== ""; });
  if (existing.length) throw new Error("แท็บ \"" + sheet.getName() + "\" ช่องที่จะใส่หัวใหม่มีข้อมูลอยู่แล้ว หยุดไว้ก่อน");
  if (lastHead >= 0) sheet.getRange(hr, lastHead + 1).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  target.setValues([missing]);
  return [sheet.getName() + ": เพิ่มหัว " + missing.join(", ")];
}

function plEnsureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
    return ["สร้างแท็บ " + name];
  }
  var cur = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  var empty = cur.every(function (v) { return String(v).trim() === ""; });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    return [name + ": ใส่หัวตาราง"];
  }
  for (var i = 0; i < headers.length; i++) {
    if (plNormHeader_(cur[i]) !== headers[i]) {
      throw new Error("แท็บ " + name + " หัวคอลัมน์ที่ " + (i + 1) + " เป็น \"" + cur[i] + "\" แต่ระบบต้องการ \"" + headers[i] + "\"");
    }
  }
  return [];
}

function plSetListValidation_(range, list, strict) {
  range.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(!strict).build()
  );
}

/* ---------------------------------------------------------------------
 * plSelfTest — รันจาก editor เพื่อตรวจเฟส ก กับชีตจริง (เขียน Log 1 แถว action = SELFTEST)
 * ------------------------------------------------------------------- */

function plSelfTest() {
  var out = {};
  var jobs = plSheet_(Config.SHEET_JOBS);
  var jm = getColMap_(jobs, plValues_(Config.JOB_COLS).concat(plValues_(Config.NEW_JOB_COLS)));
  out.jobCols = {};
  Object.keys(Config.NEW_JOB_COLS).forEach(function (k) {
    out.jobCols[Config.NEW_JOB_COLS[k]] = plColLetter_(jm[Config.NEW_JOB_COLS[k]] + 1);
  });
  var tm = getColMap_(plSheet_(Config.SHEET_TRANSPORT), plValues_(Config.NEW_TRANSPORT_COLS));
  out.transportCols = {};
  plValues_(Config.NEW_TRANSPORT_COLS).forEach(function (n) { out.transportCols[n] = plColLetter_(tm[n] + 1); });

  // วันที่: ลองแปลงทุกช่องวันที่ของแท็บ 2026 นับช่องที่แปลงไม่ได้
  var last = jobs.getLastRow();
  var dateCols = [Config.JOB_COLS.SHIP_DATE, Config.JOB_COLS.INSTALL_DATE, Config.JOB_COLS.AD_ON];
  out.dates = {};
  dateCols.forEach(function (name) {
    var vals = jobs.getRange(Config.DATA_START_ROW, jm[name] + 1, last - Config.DATA_START_ROW + 1, 1).getValues();
    var filled = 0, bad = [], roundTrip = 0;
    vals.forEach(function (r, i) {
      var v = r[0];
      if (v === "" || v == null) return;
      filled++;
      var d = parseDate_(v);
      if (!d) { if (bad.length < 5) bad.push("แถว " + (i + Config.DATA_START_ROW) + ": " + v); return; }
      if (typeof v === "string" && formatDate_(d) === v.trim()) roundTrip++;
    });
    out.dates[name] = { filled: filled, unparsed: bad, sameTextAfterFormat: roundTrip };
  });

  out.me = getMyContext();
  out.users = Object.keys(plUsers_()).length;
  out.workdays = {
    "2026-11-13 (ศ.) + 3 วันทำการ": plDateKey_(plAddWorkdays_("13-Nov-2026", 3)),
    "2026-12-03 (พฤ.) + 3 วันทำการ": plDateKey_(plAddWorkdays_("3-Dec-2026", 3))
  };
  out.log = withLock_(function () {
    return appendLog_([{ email: out.me.email, action: "SELFTEST", newVal: "ทดสอบระบบ Log เฟส ก" }]);
  });
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

// ตรวจว่า Apps Script อ่านอีเมลผู้ใช้ได้ไหม (รันจาก editor)
// ถ้ายังไม่ได้ให้สิทธิ์ "ดูอีเมล" บรรทัดแรกจะเปิดหน้าขอสิทธิ์ใหม่ (ต้องติ๊กช่องอีเมลแล้วกด Allow)
function plWhoAmI() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://www.googleapis.com/auth/userinfo.email"]);
  var r = {};
  try { r.active = Session.getActiveUser().getEmail(); } catch (e) { r.activeError = String(e); }
  try { r.effective = Session.getEffectiveUser().getEmail(); } catch (e) { r.effectiveError = String(e); }
  Logger.log(JSON.stringify(r));
  return r;
}

function plColLetter_(n) {
  var s = "";
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
