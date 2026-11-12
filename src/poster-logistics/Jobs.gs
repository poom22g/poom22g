/* =====================================================================
 * Poster Logistics — เฟส ข: API + state machine (ใช้ของจาก Logistics.gs)
 * ฟังก์ชันสาธารณะ (google.script.run) คืนผลเป็น { ok:true, ... } หรือ { ok:false, code, message, job? }
 *   code: FORBIDDEN / BAD_STATE / CONFLICT / NEED_REASON / INVALID / OLD_ROW / NOT_FOUND / AMBIGUOUS / BUSY / ERROR
 * ทุกการเขียน: ตรวจ role → lock → หาแถว (กันแถวเลื่อน) → ตรวจสถานะ → เทียบ version (BC) → เขียน → BB/BC → Log → ล้าง cache
 * ฟังก์ชันภายใน (ลงท้าย _) รับ user เป็นพารามิเตอร์ เพื่อให้ชุดทดสอบจำลองแต่ละบทบาทได้
 * ===================================================================== */

// ฟิลด์ของงาน → ชื่อหัวคอลัมน์ในแท็บ 2026 ("#2" = หัวชื่อซ้ำตัวที่ 2 คือชุด "ป้ายใหม่")
var PL_F = {
  statusB: "Status", year: "Year", month: "Month", sign: "ตำแหน่งป้าย", iata: "IATA", airport: "สนามบิน",
  customer: "ชื่อสินค้า#2", version: "เวอร์ชั่น#2", oldCustomer: "ชื่อสินค้า", media: "สื่อ", material: "วัสดุ",
  shipTo: "การจัดส่ง / สถานที่รับงาน", receiver: "ผู้รับและเบอร์โทร",
  shipDate: "วันที่จัดส่ง Poster", installDate: "วันที่ติดตั้ง Poster", adOn: "ad release", team: "ทีมติดตั้ง", remark: "Remark",
  status: "สถานะงาน", confirmedBy: "ยืนยันกำหนดการโดย", confirmedAt: "ยืนยันกำหนดการเมื่อ", reason: "เหตุผล",
  shippedAt: "ส่งจริงเมื่อ", tracking: "ขนส่ง / เลขพัสดุ", receivedAt: "รับของเมื่อ", condition: "สภาพของ",
  installedAt: "ติดตั้งจริงเมื่อ", photos: "รูปติดตั้ง", proofAt: "ส่ง Proof เมื่อ", updatedBy: "แก้ล่าสุดโดย", updatedAt: "แก้ล่าสุดเมื่อ"
};
var PL_DATE_FIELDS = { shipDate: 1, installDate: 1, adOn: 1 };              // คอลัมน์วันที่เดิม เขียนเป็น Date จริง
var PL_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ---------------------------------------------------------------------
 * อ่านข้อมูล
 * ------------------------------------------------------------------- */

function plJobsCtx_() {
  var sh = plSheet_(Config.SHEET_JOBS);
  var map = getColMap_(sh, plValues_(PL_F).filter(function (h) { return h.indexOf("#") < 0; }));
  var col = {};
  Object.keys(PL_F).forEach(function (k) { col[k] = (PL_F[k] in map) ? map[PL_F[k]] : -1; });
  if (col.customer < 0) col.customer = col.oldCustomer;
  if (col.version < 0) col.version = -1;
  return { sheet: sh, col: col, width: sh.getLastColumn() };
}

function plMonthKey_(year, month) {
  var y = parseInt(year, 10);
  var m = PL_MONTH_NAMES.indexOf(String(month || "").trim());
  if (m < 0) { var n = parseInt(month, 10); if (n >= 1 && n <= 12) m = n - 1; }
  if (!y || m < 0) return "";
  return y + "-" + (m < 9 ? "0" : "") + (m + 1);
}

function plCell_(row, c) { return c < 0 ? "" : row[c]; }
function plStr_(v) { return v == null ? "" : String(v).trim(); }

// แถวในชีต (values จาก getValues) → อ็อบเจกต์งาน ที่ส่งให้หน้าเว็บได้ (วันที่เป็น yyyy-MM-dd)
function plRowToJob_(ctx, values, rowNum) {
  var c = ctx.col, v = values;
  var job = { row: rowNum };
  ["sign", "iata", "airport", "customer", "version", "media", "material", "shipTo", "receiver", "team", "remark",
    "status", "confirmedBy", "confirmedAt", "reason", "shippedAt", "tracking", "receivedAt", "condition",
    "installedAt", "photos", "proofAt", "updatedBy", "updatedAt"].forEach(function (k) {
      job[k] = plStr_(plCell_(v, c[k]));
    });
  if (!job.customer && c.oldCustomer >= 0) job.customer = plStr_(v[c.oldCustomer]);
  job.shipDate = plDateKey_(plCell_(v, c.shipDate));
  job.installDate = plDateKey_(plCell_(v, c.installDate));
  job.adOn = plDateKey_(plCell_(v, c.adOn));
  job.statusB = plCell_(v, c.statusB) === true || String(plCell_(v, c.statusB)).toUpperCase() === "TRUE";
  job.monthKey = plMonthKey_(plCell_(v, c.year), plCell_(v, c.month));
  job.photoList = job.photos ? job.photos.split(/\n+/).filter(String) : [];
  job.ver = job.updatedAt;
  job.rowKey = { row: rowNum, signCode: job.sign, month: job.monthKey };
  return job;
}

function plReadRow_(ctx, rowNum) {
  return ctx.sheet.getRange(rowNum, 1, 1, ctx.width).getValues()[0];
}

// หาแถวจริงของงาน: ตรงตำแหน่งเดิม → ใช้เลย · ไม่ตรง (มีคนแทรก/ลบแถว) → ค้นทั้งแท็บด้วยรหัสป้าย + เดือน
function plLocate_(ctx, rowKey) {
  if (!rowKey || !rowKey.signCode || !rowKey.month) throw plErr_("INVALID", "ข้อมูลอ้างอิงงานไม่ครบ (แถว/รหัสป้าย/เดือน)");
  var sign = plStr_(rowKey.signCode).toUpperCase();
  var r = parseInt(rowKey.row, 10);
  if (r >= Config.DATA_START_ROW && r <= ctx.sheet.getLastRow()) {
    var v = plReadRow_(ctx, r);
    if (plStr_(v[ctx.col.sign]).toUpperCase() === sign && plMonthKey_(v[ctx.col.year], v[ctx.col.month]) === rowKey.month) {
      return { row: r, values: v };
    }
  }
  var last = ctx.sheet.getLastRow();
  var all = ctx.sheet.getRange(Config.DATA_START_ROW, 1, last - Config.DATA_START_ROW + 1, ctx.width).getValues();
  var hits = [];
  all.forEach(function (v2, i) {
    if (plStr_(v2[ctx.col.sign]).toUpperCase() === sign && plMonthKey_(v2[ctx.col.year], v2[ctx.col.month]) === rowKey.month) {
      hits.push({ row: i + Config.DATA_START_ROW, values: v2 });
    }
  });
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw plErr_("NOT_FOUND", "ไม่พบป้าย " + sign + " เดือน " + rowKey.month + " ในชีตแล้ว (อาจถูกลบหรือแก้รหัส)");
  // ป้ายเดียวกันเดือนเดียวกันมีหลายแถว: ใช้แถวที่ใกล้ตำแหน่งเดิมที่สุดไม่ได้ เพราะอาจเขียนผิดงาน
  throw plErr_("AMBIGUOUS", "ป้าย " + sign + " เดือน " + rowKey.month + " มี " + hits.length + " แถว (แถว " +
    hits.map(function (h) { return h.row; }).join(", ") + ") กรุณารีเฟรชแล้วเลือกใหม่");
}

/* ---------------------------------------------------------------------
 * ข้อมูลอ้างอิง: จุดรับของ/buffer (Transpot & Supplier) และทีมติดตั้งแนะนำ
 * ------------------------------------------------------------------- */

function plTransportMap_() {
  var sh = plSheet_(Config.SHEET_TRANSPORT);
  var N = Config.NEW_TRANSPORT_COLS;
  var map = getColMap_(sh, [Config.TRANSPORT_COLS.IATA, N.SHIP_TO, N.RECEIVER, N.PHONE, N.BUFFER]);
  var last = sh.getLastRow();
  var out = {};
  if (last < Config.DATA_START_ROW) return out;
  sh.getRange(Config.DATA_START_ROW, 1, last - Config.DATA_START_ROW + 1, sh.getLastColumn()).getValues().forEach(function (r) {
    var iata = plStr_(r[map[Config.TRANSPORT_COLS.IATA]]).toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) return;                    // ข้ามแถวหัวภูมิภาค เช่น NORTH
    var buf = parseInt(r[map[N.BUFFER]], 10);
    out[iata] = {
      shipTo: plStr_(r[map[N.SHIP_TO]]), receiver: plStr_(r[map[N.RECEIVER]]), phone: plStr_(r[map[N.PHONE]]),
      buffer: isNaN(buf) || buf < 0 ? Config.DEFAULT_BUFFER_DAYS : buf
    };
  });
  return out;
}

function plGetShipToOptions_(user, iata) {
  var code = plStr_(iata).toUpperCase();
  var t = plTransportMap_()[code] || { shipTo: "", receiver: "", phone: "", buffer: Config.DEFAULT_BUFFER_DAYS };
  return { ok: true, iata: code, shipTo: t.shipTo, receiver: t.receiver, phone: t.phone, buffer: t.buffer };
}

// ทีมติดตั้งแนะนำ: ทีมของป้ายเดียวกันครั้งล่าสุดในแท็บ 2026 → ถ้าไม่มี ใช้ "UPC 2" เมื่อแท็บความรับผิดชอบทีมระบุไว้
function plSuggestTeam_(ctx, sign, iata, beforeRow) {
  var last = ctx.sheet.getLastRow();
  var vals = ctx.sheet.getRange(Config.DATA_START_ROW, 1, last - Config.DATA_START_ROW + 1, ctx.width).getValues();
  for (var i = Math.min(vals.length, beforeRow - Config.DATA_START_ROW) - 1; i >= 0; i--) {
    if (plStr_(vals[i][ctx.col.sign]).toUpperCase() === sign && plStr_(vals[i][ctx.col.team])) return plStr_(vals[i][ctx.col.team]);
  }
  try {
    var sh = plSpreadsheet_().getSheetByName(Config.SHEET_TEAM);
    if (sh) {
      var d = sh.getDataRange().getValues();
      for (var r = 0; r < d.length; r++) {
        if (plStr_(d[r][1]).toUpperCase() === iata && plStr_(d[r][3]) === "UPC 2") return "UPC 2";
      }
    }
  } catch (e) { }
  return "";
}

// วันแนะนำตอนสร้างงาน: ติดตั้ง = Ad on − 1 · ส่ง = ติดตั้ง − buffer · ที่ส่ง = จุดรับของ default
function plSuggest_(ctx, job) {
  var t = plTransportMap_()[job.iata] || {};
  var buffer = t.buffer != null ? t.buffer : Config.DEFAULT_BUFFER_DAYS;
  var install = job.adOn ? plAddDays_(job.adOn, -1) : null;
  return {
    buffer: buffer,
    installDate: install ? plDateKey_(install) : "",
    shipDate: install ? plDateKey_(plAddDays_(install, -buffer)) : "",
    shipTo: t.shipTo || "",
    receiver: [t.receiver, t.phone].filter(String).join(" "),
    team: plSuggestTeam_(ctx, job.sign, job.iata, job.row)
  };
}

/* ---------------------------------------------------------------------
 * ตรวจวันที่ (เขียว/เหลือง/แดง)
 * ------------------------------------------------------------------- */

function plEvaluate_(job, buffer) {
  var issues = [], level = "green";
  var ship = parseDate_(job.shipDate), inst = parseDate_(job.installDate), ad = parseDate_(job.adOn);
  if (ship && inst && ship > inst) { level = "red"; issues.push("วันส่งอยู่หลังวันติดตั้ง"); }
  if (inst && ad && inst > ad) { level = "red"; issues.push("ติดตั้งหลังวัน Ad on"); }
  if (ship && inst && ship <= inst) {
    var gap = Math.round((inst - ship) / 86400000);
    if (gap < buffer) { if (level === "green") level = "yellow"; issues.push("ส่ง→ติดตั้ง " + gap + " วัน น้อยกว่า buffer " + buffer + " วัน"); }
  }
  return { level: level, issues: issues };
}

/* ---------------------------------------------------------------------
 * แกนกลางการเขียน
 * ------------------------------------------------------------------- */

function plErr_(code, message, extra) {
  var e = new Error(code + ": " + message);
  e.code = code; e.userMessage = message;
  if (extra) e.extra = extra;
  return e;
}

// ห่อฟังก์ชัน API: แปลง error เป็นผลลัพธ์ที่หน้าเว็บอ่านง่าย
function plApi_(fn) {
  try {
    return fn();
  } catch (e) {
    var out = { ok: false, code: e.code || "ERROR", message: e.userMessage || String(e.message || e) };
    if (e.extra) Object.keys(e.extra).forEach(function (k) { out[k] = e.extra[k]; });
    if (!e.code) console.error(e && e.stack ? e.stack : e);
    return out;
  }
}

/*
 * spec = {
 *   action: "ชื่อการกระทำ" (ลง Log), roles: [...], from: [สถานะที่ยอมให้เริ่ม] ("" = ยังไม่มีสถานะ),
 *   apply: function(job, ctx) → { changes: { field: ค่าใหม่ }, logNote?: "..." }  (throw plErr_ ได้)
 * }
 */
function plMutate_(user, rowKey, ver, spec) {
  requireRole_(user, spec.roles);
  return withLock_(function () {
    var ctx = plJobsCtx_();
    var loc = plLocate_(ctx, rowKey);
    var job = plRowToJob_(ctx, loc.values, loc.row);
    if (job.monthKey < Config.GO_LIVE_MONTH) {
      throw plErr_("OLD_ROW", "งานเดือน " + job.monthKey + " เก่ากว่าเดือนที่เริ่มใช้ระบบ (" + Config.GO_LIVE_MONTH + ") ระบบไม่แก้แถวนี้");
    }
    if (spec.from.indexOf(job.status) < 0) {
      throw plErr_("BAD_STATE", "ทำ \"" + spec.action + "\" ไม่ได้ เพราะสถานะตอนนี้คือ \"" + (job.status || "ยังไม่สร้างงาน") + "\"", { job: job });
    }
    if (plStr_(ver) !== job.ver) {
      throw plErr_("CONFLICT", "มีคนแก้งานนี้ไปก่อนแล้ว" + (job.updatedBy ? " (" + job.updatedBy + " เมื่อ " + job.updatedAt + ")" : "") +
        " กรุณาดูค่าล่าสุดแล้วลองใหม่", { job: job });
    }
    var res = spec.apply(job, ctx) || {};
    var changes = res.changes || {};
    var token = plNowToken_();
    changes.updatedBy = user.email;
    changes.updatedAt = token;

    var logs = [], writes = {};                                  // writes: เลขคอลัมน์ (0-based) → ค่าใหม่
    Object.keys(changes).forEach(function (f) {
      var c = ctx.col[f];
      if (c < 0) throw plErr_("ERROR", "ไม่พบคอลัมน์ของฟิลด์ " + f);
      var oldV = loc.values[c], newV = changes[f];
      if (PL_DATE_FIELDS[f]) {
        var d = parseDate_(newV);
        if (newV !== "" && !d) throw plErr_("INVALID", "วันที่ \"" + newV + "\" ไม่ถูกต้อง");
        newV = d || "";
        if (plDateKey_(oldV) === plDateKey_(newV)) return;
      } else if (f === "statusB") {
        if ((oldV === true) === (newV === true)) return;
      } else if (plStr_(oldV) === plStr_(newV)) {
        return;
      }
      writes[c] = newV;
      if (f !== "updatedBy" && f !== "updatedAt") {
        logs.push({ email: user.email, row: loc.row, sign: job.sign, col: PL_F[f].replace(/#\d+$/, ""), oldVal: oldV, newVal: newV, action: spec.action });
      }
    });
    plWriteRow_(ctx.sheet, loc.row, loc.values, writes, plSystemZone_(ctx));
    if (!logs.length) logs.push({ email: user.email, row: loc.row, sign: job.sign, action: spec.action, newVal: "(ไม่มีค่าเปลี่ยน)" });
    if (res.logNote) logs[0].action = spec.action + " · " + res.logNote;
    appendLog_(logs);
    try { if (typeof clearDashboardCache === "function") clearDashboardCache(Config.SHEET_JOBS); } catch (e) { }
    var fresh = plRowToJob_(ctx, loc.values, loc.row);          // loc.values ถูกอัปเดตตามที่เขียนแล้ว ไม่ต้องอ่านซ้ำ
    return { ok: true, job: fresh, warnings: res.warnings || [] };
  });
}

// เขียนเฉพาะคอลัมน์ที่เปลี่ยน โดยรวมคอลัมน์ที่ติดกันเป็นช่วงเดียว (เช่น AQ–BC) ลดจำนวนครั้งที่เรียกชีต
// คอลัมน์ที่อยู่ระหว่างช่วงแต่ไม่ได้เปลี่ยน จะเขียนค่าเดิมกลับ (ห้ามใช้กับคอลัมน์สูตร — AQ–BC และ B/AH–AM ไม่มีสูตร)
function plWriteRow_(sheet, rowNum, values, writes, zone) {
  var cols = Object.keys(writes).map(Number).sort(function (a, b) { return a - b; });
  var i = 0;
  while (i < cols.length) {
    var start = cols[i], end = start;
    while (i + 1 < cols.length && (cols[i + 1] - end === 1 || (end >= zone[0] && cols[i + 1] <= zone[1]))) { i++; end = cols[i]; }
    var arr = [];
    for (var c = start; c <= end; c++) {
      if (c in writes) values[c] = writes[c];
      arr.push(values[c]);
    }
    sheet.getRange(rowNum, start + 1, 1, arr.length).setValues([arr]);
    i++;
  }
}

// โซนคอลัมน์ที่ระบบดูแลเอง (สถานะงาน … แก้ล่าสุดเมื่อ = AQ–BC) รวมเป็นช่วงเดียวได้แม้มีคอลัมน์ไม่เปลี่ยนคั่น
function plSystemZone_(ctx) {
  var a = ctx.col.status, b = ctx.col.updatedAt;
  return a >= 0 && b > a && b - a === (plValues_(Config.NEW_JOB_COLS).length - 1) ? [a, b] : [a, a];
}

function plNowText_() { return Utilities.formatDate(new Date(), Config.TZ, "d-MMM-yyyy HH:mm"); }

function plNeedDate_(v, label) {
  var d = parseDate_(v);
  if (!d) throw plErr_("INVALID", "กรุณาใส่" + label + "ให้ถูกต้อง (ได้รับ \"" + (v == null ? "" : v) + "\")");
  return d;
}

/* ---------------------------------------------------------------------
 * การกระทำแต่ละขั้น (ภายใน)
 * ------------------------------------------------------------------- */

var PL_S = Config.STATUS;

// ตารางสิทธิ์ + สถานะเริ่มต้นของแต่ละการกระทำ — ใช้ทั้งฝั่ง server (ตรวจจริง) และส่งให้หน้าจอใช้ซ่อน/แสดงปุ่ม
var PL_ACTIONS = {
  create:      { label: "สร้างงาน", roles: ["AE"], from: [""] },
  updateAdOn:  { label: "แก้วัน Ad on", roles: ["AE"], from: [PL_S.WAIT_OPS, PL_S.SCHEDULED, PL_S.WAIT_AE, PL_S.SHIPPED, PL_S.RESHIP, PL_S.RECEIVED, PL_S.INSTALLED, PL_S.INSTALLED_MANUAL] },
  confirm:     { label: "ยืนยันกำหนดการ", roles: ["Ops"], from: [PL_S.WAIT_OPS, PL_S.SCHEDULED, PL_S.WAIT_AE, PL_S.RESHIP] },
  ackLate:     { label: "รับทราบติดตั้งช้า", roles: ["AE"], from: [PL_S.WAIT_AE] },
  shipped:     { label: "ส่งแล้ว", roles: ["Ops", "Production"], from: [PL_S.SCHEDULED, PL_S.RESHIP] },
  received:    { label: "ได้รับของแล้ว", roles: ["Ops", "MA"], from: [PL_S.SHIPPED] },
  installed:   { label: "ติดตั้งแล้ว", roles: ["Installer", "Ops"], from: [PL_S.RECEIVED] },
  proofSent:   { label: "ส่ง Proof แล้ว", roles: ["AE"], from: [PL_S.ON_AIR] }
};
function plAct_(key, extra) {
  var a = PL_ACTIONS[key], o = { action: a.label, roles: a.roles, from: a.from };
  Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  return o;
}

// AE สร้างงาน: แถวป้ายที่มีอยู่แล้วในแท็บ 2026 · ใส่วัน Ad on → "รอ Ops รับงาน"
function plCreateJob_(user, rowKey, payload, ver) {
  payload = payload || {};
  var r = plMutate_(user, rowKey, ver, plAct_("create", {
    apply: function (job) {
      var ad = plNeedDate_(payload.adOn || job.adOn, "วัน Ad on ");
      return { changes: { adOn: ad, status: PL_S.WAIT_OPS } };
    }
  }));
  if (r.ok) r.suggest = plSuggest_(plJobsCtx_(), r.job);
  return r;
}

// AE แก้วัน Ad on (ก่อน On air) · หลัง Ops ยืนยันแล้วต้องมีเหตุผล · ถ้าวันติดตั้งเลย Ad on ใหม่ → "รอ AE รับทราบ"
function plUpdateAdOn_(user, rowKey, payload, ver) {
  payload = payload || {};
  return plMutate_(user, rowKey, ver, plAct_("updateAdOn", {
    apply: function (job) {
      var ad = plNeedDate_(payload.adOn, "วัน Ad on ");
      var reason = plStr_(payload.reason);
      if (job.status !== PL_S.WAIT_OPS && !reason) throw plErr_("NEED_REASON", "งานนี้ Ops ยืนยันแล้ว การแก้วัน Ad on ต้องใส่เหตุผล");
      var ch = { adOn: ad };
      if (reason) ch.reason = reason;
      var inst = parseDate_(job.installDate);
      if (job.status === PL_S.SCHEDULED && inst && inst > ad) ch.status = PL_S.WAIT_AE;
      return { changes: ch, logNote: reason };
    }
  }));
}

// Ops ยืนยันกำหนดการ (AH, AI, AJ, AK, AM) · ใช้ทั้งยืนยันครั้งแรกและแก้วันภายหลัง (ต้องมีเหตุผล)
function plConfirmSchedule_(user, rowKey, payload, ver) {
  payload = payload || {};
  return plMutate_(user, rowKey, ver, plAct_("confirm", {
    apply: function (job) {
      var shipTo = plStr_(payload.shipTo != null ? payload.shipTo : job.shipTo);
      var team = plStr_(payload.team != null ? payload.team : job.team);
      var ship = plNeedDate_(payload.shipDate, "วันจัดส่ง ");
      var inst = plNeedDate_(payload.installDate, "วันติดตั้ง ");
      var ad = parseDate_(job.adOn);
      var reason = plStr_(payload.reason);
      if (!shipTo) throw plErr_("INVALID", "กรุณาใส่สถานที่จัดส่ง");
      if (!ad) throw plErr_("INVALID", "งานนี้ยังไม่มีวัน Ad on ให้ AE ใส่ก่อน");
      if (team && Config.INSTALL_TEAMS.indexOf(team) < 0) throw plErr_("INVALID", "ทีมติดตั้งต้องเป็น " + Config.INSTALL_TEAMS.join(" / "));
      if (ship > inst) throw plErr_("INVALID", "วันส่งอยู่หลังวันติดตั้ง ไม่สมเหตุสมผล");
      var isEdit = job.status !== PL_S.WAIT_OPS;
      if (isEdit && !reason) throw plErr_("NEED_REASON", "แก้กำหนดการหลังยืนยันแล้ว ต้องใส่เหตุผล");
      var late = inst > ad;
      if (late && !reason) throw plErr_("NEED_REASON", "วันติดตั้งอยู่หลังวัน Ad on ต้องใส่เหตุผล แล้วระบบจะส่งให้ AE รับทราบ");
      var ch = { shipTo: shipTo, shipDate: ship, installDate: inst, team: team, confirmedBy: user.email, confirmedAt: plNowText_() };
      if (payload.receiver != null) ch.receiver = plStr_(payload.receiver);
      if (reason) ch.reason = reason;
      if (job.status === PL_S.RESHIP) ch.status = PL_S.RESHIP;           // รอส่งใหม่: เปลี่ยนวันได้ สถานะคงเดิม
      else ch.status = late ? PL_S.WAIT_AE : PL_S.SCHEDULED;
      var buf = (plTransportMap_()[job.iata] || {}).buffer;
      var ev = plEvaluate_({ shipDate: plDateKey_(ship), installDate: plDateKey_(inst), adOn: job.adOn }, buf != null ? buf : Config.DEFAULT_BUFFER_DAYS);
      return { changes: ch, logNote: reason, warnings: ev.issues };
    }
  }));
}

// AE รับทราบแถวแดง (ติดตั้งหลัง Ad on) → "มีกำหนด"
function plAcknowledgeLate_(user, rowKey, ver) {
  return plMutate_(user, rowKey, ver, plAct_("ackLate", {
    apply: function () { return { changes: { status: PL_S.SCHEDULED } }; }
  }));
}

// ส่งของแล้ว + เลขพัสดุ
function plMarkShipped_(user, rowKey, payload, ver) {
  payload = payload || {};
  return plMutate_(user, rowKey, ver, plAct_("shipped", {
    apply: function (job) {
      var tracking = plStr_(payload.tracking);
      if (!tracking) throw plErr_("INVALID", "กรุณาใส่ขนส่ง / เลขพัสดุ");
      return { changes: { status: PL_S.SHIPPED, shippedAt: plNowText_(), tracking: tracking }, logNote: plStr_(payload.note) };
    }
  }));
}

// รับของปลายทาง: ครบ → "รับของแล้ว" · เสียหาย → "รอส่งใหม่" (ต้องมีหมายเหตุ)
function plMarkReceived_(user, rowKey, payload, ver) {
  payload = payload || {};
  return plMutate_(user, rowKey, ver, plAct_("received", {
    apply: function (job) {
      var cond = plStr_(payload.condition);
      if (Config.CONDITIONS.indexOf(cond) < 0) throw plErr_("INVALID", "สภาพของต้องเป็น " + Config.CONDITIONS.join(" หรือ "));
      var note = plStr_(payload.note);
      var ch = { receivedAt: plNowText_(), condition: cond };
      if (cond === "เสียหาย") {
        if (!note) throw plErr_("NEED_REASON", "ของเสียหาย กรุณาบอกว่าเสียหายอย่างไร");
        ch.status = PL_S.RESHIP;
        ch.reason = note;
      } else {
        ch.status = PL_S.RECEIVED;
      }
      if (payload.photoUrls && payload.photoUrls.length) ch.photos = plJoinPhotos_(job.photoList, payload.photoUrls);
      return { changes: ch, logNote: note };
    }
  }));
}

// ติดตั้งแล้ว + รูป · มีรูป ≥ 1 → ติ๊กคอลัมน์ B ให้เอง · Ops กดแทน Installer ได้ (ลง Log ว่ากดแทน)
// payload.photoUrls = ลิงก์รูปที่อัปโหลดแล้ว (ฟังก์ชันอัปโหลดรูปเข้า Drive มาในเฟส ค)
function plMarkInstalled_(user, rowKey, payload, ver) {
  payload = payload || {};
  return plMutate_(user, rowKey, ver, plAct_("installed", {
    apply: function (job) {
      var photos = plJoinPhotos_(job.photoList, payload.photoUrls || []);
      var count = photos ? photos.split("\n").length : 0;
      var ch = { status: PL_S.INSTALLED, installedAt: plNowText_(), photos: photos };
      if (count >= 1) ch.statusB = true;
      var notes = [];
      if (user.role === "Ops") notes.push("Ops กดแทน Installer");
      if (payload.checklist && payload.checklist.length) notes.push("เช็กลิสต์: " + payload.checklist.join(", "));
      if (plStr_(payload.note)) notes.push(plStr_(payload.note));
      var warnings = count ? [] : ["ยังไม่มีรูปติดตั้ง จึงยังไม่ติ๊กคอลัมน์ Status"];
      return { changes: ch, logNote: notes.join(" · "), warnings: warnings };
    }
  }));
}

// AE ส่ง Proof แล้ว (หลัง On air) → ปิดงาน
function plMarkProofSent_(user, rowKey, ver) {
  return plMutate_(user, rowKey, ver, plAct_("proofSent", {
    apply: function () { return { changes: { status: PL_S.CLOSED, proofAt: plNowText_() } }; }
  }));
}

function plJoinPhotos_(existing, added) {
  var seen = {}, out = [];
  (existing || []).concat(added || []).forEach(function (u) {
    u = plStr_(u);
    if (!u || seen[u]) return;
    if (!/^https:\/\//.test(u)) throw plErr_("INVALID", "ลิงก์รูปไม่ถูกต้อง: " + u);
    seen[u] = 1; out.push(u);
  });
  return out.join("\n");
}

/* ---------------------------------------------------------------------
 * อ่านรายการงาน / รายละเอียด
 * ------------------------------------------------------------------- */

// filters: { month: "2026-11", iata, status, team, q } · ค่าเริ่มต้น = ตั้งแต่เดือนที่เริ่มใช้ระบบ
function plListPosterJobs_(user, filters) {
  filters = filters || {};
  var ctx = plJobsCtx_();
  var last = ctx.sheet.getLastRow();
  var vals = last >= Config.DATA_START_ROW
    ? ctx.sheet.getRange(Config.DATA_START_ROW, 1, last - Config.DATA_START_ROW + 1, ctx.width).getValues() : [];
  var tmap = plTransportMap_();
  var created = plCreatedAt_();
  var today = plDateKey_(new Date());
  var q = plStr_(filters.q).toLowerCase();
  var jobs = [];
  vals.forEach(function (v, i) {
    var job = plRowToJob_(ctx, v, i + Config.DATA_START_ROW);
    if (!job.sign || !job.monthKey) return;
    if (filters.month ? job.monthKey !== filters.month : job.monthKey < Config.GO_LIVE_MONTH) return;
    if (filters.iata && job.iata !== filters.iata) return;
    if (filters.status && job.status !== filters.status) return;
    if (filters.team && job.team !== filters.team) return;
    if (q && (job.sign + " " + job.customer + " " + job.airport).toLowerCase().indexOf(q) < 0) return;
    var buf = (tmap[job.iata] || {}).buffer;
    job.check = plEvaluate_(job, buf != null ? buf : Config.DEFAULT_BUFFER_DAYS);
    job.createdAt = created[job.row + "|" + job.sign] || "";
    job.slaOverdue = job.status === PL_S.WAIT_OPS && !!job.createdAt &&
      plDateKey_(plAddWorkdays_(job.createdAt, Config.SLA_WORKDAYS)) < today;
    job.week = plWeekKey_(job.installDate || job.adOn);
    jobs.push(job);
  });
  // จัดกลุ่มตามลูกค้า + สัปดาห์ (วันติดตั้ง หรือ Ad on ถ้ายังไม่มีวันติดตั้ง)
  var groups = {}, order = [];
  jobs.forEach(function (j, idx) {
    var k = (j.customer || "(ไม่ระบุลูกค้า)") + "|" + j.week;
    if (!groups[k]) { groups[k] = { customer: j.customer || "(ไม่ระบุลูกค้า)", week: j.week, items: [] }; order.push(k); }
    groups[k].items.push(idx);
  });
  order.sort(function (a, b) {
    var ga = groups[a], gb = groups[b];
    return (ga.week || "9999") < (gb.week || "9999") ? -1 : (ga.week || "9999") > (gb.week || "9999") ? 1 : ga.customer < gb.customer ? -1 : 1;
  });
  return {
    ok: true, me: { email: user.email, name: user.name, role: user.role, via: user.via || "" },
    testMode: plIsTestMode_(), actions: PL_ACTIONS, status: Config.STATUS, teams: Config.INSTALL_TEAMS,
    conditions: Config.CONDITIONS, goLive: Config.GO_LIVE_MONTH,
    jobs: jobs, groups: order.map(function (k) { return groups[k]; }),
    fetchedAt: Utilities.formatDate(new Date(), Config.TZ, "yyyy-MM-dd HH:mm")
  };
}

// สัปดาห์ของวันที่ = วันจันทร์ของสัปดาห์นั้น (yyyy-MM-dd)
function plWeekKey_(v) {
  var d = parseDate_(v);
  if (!d) return "";
  var back = (d.getDay() + 6) % 7;
  return plDateKey_(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12));
}

// เวลาที่ AE สร้างงาน อ่านจาก Log (ใช้คิด SLA ของ Ops) → { "แถว|ป้าย": "yyyy-MM-dd HH:mm:ss" }
function plCreatedAt_() {
  var sh = plSheet_(Config.SHEET_LOG);
  var last = sh.getLastRow();
  var out = {};
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 8).getDisplayValues().forEach(function (r) {
    if (r[7].indexOf("สร้างงาน") === 0 && !out[r[2] + "|" + r[3]]) out[r[2] + "|" + r[3]] = r[0];
  });
  return out;
}

function plGetJob_(user, rowKey) {
  var ctx = plJobsCtx_();
  var loc = plLocate_(ctx, rowKey);
  var job = plRowToJob_(ctx, loc.values, loc.row);
  var buf = (plTransportMap_()[job.iata] || {}).buffer;
  job.check = plEvaluate_(job, buf != null ? buf : Config.DEFAULT_BUFFER_DAYS);
  var sh = plSheet_(Config.SHEET_LOG);
  var last = sh.getLastRow();
  var history = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 8).getDisplayValues().forEach(function (r) {
      if (String(r[2]) === String(loc.row) && r[3] === job.sign) {
        history.push({ at: r[0], email: r[1], col: r[4], oldVal: r[5], newVal: r[6], action: r[7] });
      }
    });
  }
  return { ok: true, job: job, history: history.reverse(), suggest: plSuggest_(ctx, job), ver: job.ver };
}

/* ---------------------------------------------------------------------
 * รูปติดตั้ง/รูปรับของ: หน้าเว็บย่อรูปเหลือด้านยาว ~1600px แล้วส่งเป็น data URL ทีละรูป
 * เก็บที่ Drive: <PHOTO_FOLDER_ID>/<รหัสป้าย>/ · ตรวจชนิดไฟล์จาก header จริง + ขนาด ฝั่ง server
 * ------------------------------------------------------------------- */

var PL_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
var PL_PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function plUploadJobPhoto_(user, rowKey, file) {
  requireRole_(user, ["Installer", "Ops", "MA"]);
  file = file || {};
  var m = String(file.dataUrl || "").match(/^data:([\w\/+.-]+);base64,([A-Za-z0-9+\/=\s]+)$/);
  if (!m) throw plErr_("INVALID", "ไฟล์รูปไม่ถูกต้อง");
  var type = m[1].toLowerCase(), ext = PL_PHOTO_TYPES[type];
  if (!ext) throw plErr_("INVALID", "รองรับเฉพาะรูป JPG / PNG / WebP");
  var bytes = Utilities.base64Decode(m[2].replace(/\s+/g, ""));
  if (bytes.length > PL_PHOTO_MAX_BYTES) throw plErr_("INVALID", "รูปใหญ่เกิน 8 MB");
  if (bytes.length < 200 || !plImageMagicOk_(bytes, type)) throw plErr_("INVALID", "ไฟล์นี้ไม่ใช่รูปภาพ");
  var rootId = Config.prop("PHOTO_FOLDER_ID");
  if (!rootId) throw plErr_("ERROR", "ยังไม่ได้ตั้งโฟลเดอร์เก็บรูป (Script Property PHOTO_FOLDER_ID) กรุณาแจ้ง Admin");
  var ctx = plJobsCtx_();
  var loc = plLocate_(ctx, rowKey);
  var job = plRowToJob_(ctx, loc.values, loc.row);
  if (job.monthKey < Config.GO_LIVE_MONTH) throw plErr_("OLD_ROW", "งานเดือนเก่ากว่าที่เริ่มใช้ระบบ");
  var folder = withLock_(function () {
    var root = DriveApp.getFolderById(rootId);
    var it = root.getFoldersByName(job.sign);
    return it.hasNext() ? it.next() : root.createFolder(job.sign);
  });
  var name = job.sign + "_" + job.monthKey + "_" + Utilities.formatDate(new Date(), Config.TZ, "yyyyMMdd-HHmmss") +
    "_" + Math.floor(Math.random() * 1e4) + "." + ext;
  var f = folder.createFile(Utilities.newBlob(bytes, type, name));
  f.setDescription("แถว " + loc.row + " · " + (file.kind || "ติดตั้ง") + " · อัปโหลดโดย " + user.email);
  return { ok: true, url: "https://drive.google.com/file/d/" + f.getId() + "/view", id: f.getId(), name: name };
}

function plImageMagicOk_(b, type) {
  function u(i) { return b[i] & 255; }
  if (type === "image/jpeg") return u(0) === 0xFF && u(1) === 0xD8;
  if (type === "image/png") return u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47;
  if (type === "image/webp") return u(0) === 0x52 && u(1) === 0x49 && u(8) === 0x57 && u(9) === 0x45;
  return false;
}

// หน้าจอ Poster Logistics อยู่ในไฟล์ HTML แยก (PosterLogistics.html) — Dashboard โหลดมาฝังเมื่อเปิดใช้
// แยกไฟล์ไว้เพื่อไม่ต้องแก้ Dashboard.html มาก และไม่ต้องเปลี่ยน doGet
function plGetUi() {
  return HtmlService.createHtmlOutputFromFile("PosterLogistics").getContent();
}

/* ---------------------------------------------------------------------
 * API สาธารณะ — ตรวจผู้ใช้ที่ server ทุกครั้ง ไม่เชื่อค่าจากหน้าเว็บ
 * หน้าเว็บเรียกผ่าน plCall(token, ชื่อคำสั่ง, [ค่า]) ใน Auth.gs
 * ฟังก์ชันชื่อเดิมข้างล่างยังเก็บไว้ (ใช้ได้เฉพาะคนที่ระบบเห็นบัญชี Google) — ไม่รู้ว่าเป็นใคร = LOGIN_REQUIRED
 * ------------------------------------------------------------------- */

function listPosterJobs(filters) { return plCall("", "listPosterJobs", [filters]); }
function getJob(rowKey) { return plCall("", "getJob", [rowKey]); }
function getShipToOptions(iata) { return plCall("", "getShipToOptions", [iata]); }
function createJob(rowKey, payload, ver) { return plCall("", "createJob", [rowKey, payload, ver]); }
function updateAdOn(rowKey, payload, ver) { return plCall("", "updateAdOn", [rowKey, payload, ver]); }
function confirmSchedule(rowKey, payload, ver) { return plCall("", "confirmSchedule", [rowKey, payload, ver]); }
function acknowledgeLate(rowKey, ver) { return plCall("", "acknowledgeLate", [rowKey, ver]); }
function markShipped(rowKey, payload, ver) { return plCall("", "markShipped", [rowKey, payload, ver]); }
function markReceived(rowKey, payload, ver) { return plCall("", "markReceived", [rowKey, payload, ver]); }
function markInstalled(rowKey, payload, ver) { return plCall("", "markInstalled", [rowKey, payload, ver]); }
function uploadJobPhoto(rowKey, file) { return plCall("", "uploadJobPhoto", [rowKey, file]); }
function markProofSent(rowKey, ver) { return plCall("", "markProofSent", [rowKey, ver]); }
