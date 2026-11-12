/* =====================================================================
 * ชุดทดสอบเฟส ข — รันบน "สำเนา" ของชีตเท่านั้น (ไม่แตะชีตจริง)
 * วิธีใช้: เลือกฟังก์ชัน plTestPhaseB แล้วกด Run · ดูผลใน Execution log
 * ID สำเนาเก็บใน Script Properties ชื่อ PL_TEST_SPREADSHEET_ID (ถ้าไม่มี ใช้ค่าด้านล่าง)
 * ===================================================================== */

var PL_TEST_SPREADSHEET_DEFAULT = "YOUR_TEST_SPREADSHEET_ID";  // [TEST] Poster Logistics phase B - ลบได้

function plTestPhaseB() {
  plRequireAdminCaller_();
  var testId = PropertiesService.getScriptProperties().getProperty("PL_TEST_SPREADSHEET_ID") || PL_TEST_SPREADSHEET_DEFAULT;
  if (testId === PL_REAL_SPREADSHEET_ID_) throw new Error("ห้ามรันชุดทดสอบบนชีตจริง");
  var realId = Config.SPREADSHEET_ID;
  Config.SPREADSHEET_ID = testId;
  var results = [];
  function check(name, cond, detail) {
    results.push((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  → " + JSON.stringify(detail)));
  }
  function code(r) { return r && r.ok ? "OK" : (r && r.code); }
  // เรียกฟังก์ชันภายในแบบเดียวกับ API สาธารณะ (แปลง error เป็นผลลัพธ์)
  function call(fn) { var a = [].slice.call(arguments, 1); return plApi_(function () { return fn.apply(null, a); }); }

  var AE = { email: "ae@test", name: "AE", role: "AE" }, OPS = { email: "ops@test", name: "Ops", role: "Ops" };
  var PROD = { email: "prod@test", name: "Prod", role: "Production" }, MA = { email: "ma@test", name: "MA", role: "MA" };
  var INS = { email: "ins@test", name: "Ins", role: "Installer" }, NOBODY = { email: "x@test", name: "", role: "" };
  var ADMIN = { email: "admin@test", name: "Admin", role: "Admin" };

  try {
    var ctx = plJobsCtx_();
    var sh = ctx.sheet;
    var last = sh.getLastRow();
    var all = sh.getRange(Config.DATA_START_ROW, 1, last - Config.DATA_START_ROW + 1, ctx.width).getValues();
    // หาแถวทดสอบ: เดือน 2026-11 ที่ยังไม่มีสถานะงาน และรหัสป้ายไม่ซ้ำในเดือนนั้น · แถวเดือนเก่า 1 แถว
    var nov = [], old = null, countBy = {};
    all.forEach(function (v, i) {
      var mk = plMonthKey_(v[ctx.col.year], v[ctx.col.month]), sign = plStr_(v[ctx.col.sign]).toUpperCase();
      if (!sign) return;
      countBy[sign + "|" + mk] = (countBy[sign + "|" + mk] || 0) + 1;
      if (mk === "2026-11" && !plStr_(v[ctx.col.status])) nov.push(i + Config.DATA_START_ROW);
      if (mk && mk < "2026-11" && !old) old = i + Config.DATA_START_ROW;
    });
    nov = nov.filter(function (r) { var v = all[r - Config.DATA_START_ROW]; return countBy[plStr_(v[ctx.col.sign]).toUpperCase() + "|2026-11"] === 1; });
    if (nov.length < 2) throw new Error("ในสำเนาไม่มีแถว 2026-11 ว่างพอทดสอบ");
    var R = nov[0], R2 = nov[1];
    var job0 = plRowToJob_(ctx, plReadRow_(ctx, R), R);
    var key = job0.rowKey;
    results.push("INFO แถวทดสอบ " + R + " ป้าย " + key.signCode + " · แถวสำรอง " + R2 + " · แถวเดือนเก่า " + old);

    // --- สร้างงาน ---
    var r = call(plCreateJob_, OPS, key, { adOn: "2026-11-20" }, "");
    check("Ops สร้างงานไม่ได้ (FORBIDDEN)", code(r) === "FORBIDDEN", r);
    r = call(plCreateJob_, NOBODY, key, { adOn: "2026-11-20" }, "");
    check("คนไม่มีบทบาทสร้างงานไม่ได้", code(r) === "FORBIDDEN", r);
    r = call(plCreateJob_, AE, key, { adOn: "31-Feb-2026" }, "");
    check("วัน Ad on ผิด → INVALID", code(r) === "INVALID", r);
    r = call(plCreateJob_, AE, key, { adOn: "20-Nov-2026" }, "");
    check("AE สร้างงาน → รอ MA แจ้งแผน", r.ok && r.job.status === Config.STATUS.WAIT_MA && r.job.adOn === "2026-11-20", r);
    check("แนะนำวันติดตั้ง = Ad on − 1", r.ok && r.suggest.installDate === "2026-11-19", r.suggest);
    check("แนะนำวันส่ง = ติดตั้ง − buffer", r.ok && r.suggest.shipDate === plDateKey_(plAddDays_("2026-11-19", -r.suggest.buffer)), r.suggest);
    check("เขียนแก้ล่าสุดโดย/เมื่อ", r.ok && r.job.updatedBy === "ae@test" && !!r.job.ver, r.job);
    var ver = r.job.ver;
    check("AD on ในชีตเป็น Date จริง", sh.getRange(R, ctx.col.adOn + 1).getValue() instanceof Date, sh.getRange(R, ctx.col.adOn + 1).getValue());
    r = call(plCreateJob_, AE, key, { adOn: "2026-11-20" }, ver);
    check("สร้างซ้ำ → BAD_STATE", code(r) === "BAD_STATE", r);

    // --- MA แจ้งแผนติดตั้ง (จุดส่ง / วันติดตั้ง / ทีม) ---
    var P = { shipTo: "สนามบิน", installDate: "2026-11-19", team: "Operation" };
    r = call(plPlanInstall_, MA, key, P, "");
    check("ver เก่า → CONFLICT (ไม่เขียนทับเงียบ)", code(r) === "CONFLICT" && r.job && r.job.status === Config.STATUS.WAIT_MA, r);
    r = call(plPlanInstall_, AE, key, P, ver);
    check("AE แจ้งแผนติดตั้งไม่ได้", code(r) === "FORBIDDEN", r);
    r = call(plPlanInstall_, OPS, key, P, ver);
    check("Ops แจ้งแผนติดตั้งไม่ได้", code(r) === "FORBIDDEN", r);
    r = call(plSetShipDate_, ADMIN, key, { shipDate: "2026-11-17" }, ver);
    check("MA ยังไม่แจ้งแผน → Admin กำหนดวันส่งไม่ได้ (BAD_STATE)", code(r) === "BAD_STATE", r);
    r = call(plPlanInstall_, MA, key, { shipTo: "", installDate: "2026-11-19" }, ver);
    check("ไม่ใส่จุดจัดส่ง → INVALID", code(r) === "INVALID", r);
    r = call(plPlanInstall_, MA, key, { shipTo: "สนามบิน", installDate: "2026-11-19", team: "ทีมที่ไม่มี" }, ver);
    check("ทีมติดตั้งนอกรายการ → INVALID", code(r) === "INVALID", r);
    r = call(plPlanInstall_, MA, key, { shipTo: "สนามบิน", installDate: "2026-11-21", team: "Supplier" }, ver);
    check("ติดตั้งหลัง Ad on ไม่มีเหตุผล → NEED_REASON", code(r) === "NEED_REASON", r);
    var shipBefore = job0.shipDate;
    r = call(plPlanInstall_, MA, key, { shipTo: "สนามบิน", installDate: "2026-11-21", team: "Supplier", reason: "ทดสอบ: ทีมไม่ว่าง" }, ver);
    check("MA แจ้งแผน (ส่ง Supplier ติด) → รอกำหนดวันส่ง", r.ok && r.job.status === Config.STATUS.WAIT_SHIP && r.job.team === "Supplier" && r.job.installDate === "2026-11-21", r);
    check("MA แจ้งแผน ไม่แตะวันส่ง และยังไม่ลงชื่อคนกำหนดวันส่ง", r.ok && r.job.shipDate === shipBefore && !r.job.confirmedBy, r.ok && [r.job.shipDate, r.job.confirmedBy]);
    ver = r.ok ? r.job.ver : ver;

    // --- Admin กำหนดวันส่ง ---
    r = call(plSetShipDate_, MA, key, { shipDate: "2026-11-19" }, ver);
    check("MA กำหนดวันส่งไม่ได้", code(r) === "FORBIDDEN", r);
    r = call(plSetShipDate_, OPS, key, { shipDate: "2026-11-19" }, ver);
    check("Ops กำหนดวันส่งไม่ได้", code(r) === "FORBIDDEN", r);
    r = call(plSetShipDate_, ADMIN, key, { shipDate: "2026-11-22" }, ver);
    check("วันส่งหลังวันติดตั้ง → INVALID", code(r) === "INVALID", r);
    r = call(plSetShipDate_, ADMIN, key, { shipDate: "2026-11-19" }, ver);
    check("Admin กำหนดวันส่ง (ติดตั้งหลัง Ad on) → รอ AE รับทราบ", r.ok && r.job.status === Config.STATUS.WAIT_AE && r.job.shipDate === "2026-11-19" && r.job.confirmedBy === "admin@test", r);
    ver = r.ok ? r.job.ver : ver;
    r = call(plMarkShipped_, OPS, key, { tracking: "X1" }, ver);
    check("ยังไม่รับทราบ ส่งของไม่ได้ (BAD_STATE)", code(r) === "BAD_STATE", r);
    r = call(plAcknowledgeLate_, OPS, key, ver);
    check("Ops กดรับทราบแทน AE ไม่ได้", code(r) === "FORBIDDEN", r);
    r = call(plAcknowledgeLate_, AE, key, ver);
    check("AE รับทราบ → มีกำหนด", r.ok && r.job.status === Config.STATUS.SCHEDULED, r);
    ver = r.ok ? r.job.ver : ver;

    // --- แก้หลังกำหนดการครบแล้ว ---
    r = call(plPlanInstall_, MA, key, P, ver);
    check("แก้แผนติดตั้งโดยไม่มีเหตุผล → NEED_REASON", code(r) === "NEED_REASON", r);
    r = call(plSetShipDate_, ADMIN, key, { shipDate: "2026-11-18" }, ver);
    check("แก้วันส่งโดยไม่มีเหตุผล → NEED_REASON", code(r) === "NEED_REASON", r);
    r = call(plPlanInstall_, MA, key, { shipTo: "สนามบิน", installDate: "2026-11-18", team: "Operation", reason: "ทดสอบ: ทีมว่างแล้ว" }, ver);
    check("วันติดตั้งใหม่อยู่ก่อนวันส่งเดิม → กลับไปรอกำหนดวันส่ง + คำเตือน", r.ok && r.job.status === Config.STATUS.WAIT_SHIP && r.warnings.length > 0 && r.job.team === "Operation", r);
    ver = r.ok ? r.job.ver : ver;
    r = call(plSetShipDate_, ADMIN, key, { shipDate: "2026-11-17" }, ver);
    check("Admin กำหนดวันส่งใหม่ → มีกำหนด", r.ok && r.job.status === Config.STATUS.SCHEDULED && r.job.shipDate === "2026-11-17" && r.job.installDate === "2026-11-18", r);
    check("ส่ง→ติดตั้ง 1 วัน < buffer → มีคำเตือน", r.ok && r.warnings.length > 0, r.warnings);
    ver = r.ok ? r.job.ver : ver;
    r = call(plSetShipDate_, ADMIN, key, { shipDate: "2026-11-16", reason: "ทดสอบ: ส่งเร็วขึ้น" }, ver);
    check("Admin แก้วันส่ง + เหตุผล → มีกำหนด", r.ok && r.job.status === Config.STATUS.SCHEDULED && r.job.shipDate === "2026-11-16", r);
    ver = r.ok ? r.job.ver : ver;
    r = call(plPlanInstall_, MA, key, { shipTo: "สนามบิน", installDate: "2026-11-19", team: "Operation", reason: "ทดสอบ: เลื่อนติดตั้ง" }, ver);
    check("MA แก้แผน + เหตุผล (วันส่งยังใช้ได้) → มีกำหนด", r.ok && r.job.status === Config.STATUS.SCHEDULED && r.job.installDate === "2026-11-19" && r.job.shipDate === "2026-11-16", r);
    ver = r.ok ? r.job.ver : ver;
    check("MA มีสิทธิ์กด \"ติดตั้งแล้ว\" (ติดเองหรือส่ง Supplier ติด)", PL_ACTIONS.installed.roles.indexOf("MA") >= 0, PL_ACTIONS.installed.roles);

    // --- ส่งของ / รับของ ---
    r = call(plMarkShipped_, INS, key, { tracking: "X1" }, ver);
    check("Installer กดส่งของไม่ได้", code(r) === "FORBIDDEN", r);
    r = call(plMarkShipped_, PROD, key, {}, ver);
    check("ไม่มีเลขพัสดุ → INVALID", code(r) === "INVALID", r);
    r = call(plMarkShipped_, PROD, key, { tracking: "Kerry TEST001" }, ver);
    check("Production ส่งแล้ว", r.ok && r.job.status === Config.STATUS.SHIPPED && r.job.tracking === "Kerry TEST001" && !!r.job.shippedAt, r);
    ver = r.ok ? r.job.ver : ver;
    r = call(plMarkReceived_, MA, key, { condition: "เสียหาย" }, ver);
    check("ของเสียหายไม่บอกอาการ → NEED_REASON", code(r) === "NEED_REASON", r);
    r = call(plMarkReceived_, MA, key, { condition: "เสียหาย", note: "ทดสอบ: มุมฉีก" }, ver);
    check("ของเสียหาย → รอส่งใหม่", r.ok && r.job.status === Config.STATUS.RESHIP && r.job.condition === "เสียหาย", r);
    ver = r.ok ? r.job.ver : ver;
    r = call(plMarkShipped_, OPS, key, { tracking: "Kerry TEST002" }, ver);
    check("ส่งใหม่ → ส่งแล้ว", r.ok && r.job.status === Config.STATUS.SHIPPED, r);
    ver = r.ok ? r.job.ver : ver;
    r = call(plMarkReceived_, MA, key, { condition: "ครบ" }, ver);
    check("รับของครบ → รับของแล้ว", r.ok && r.job.status === Config.STATUS.RECEIVED, r);
    ver = r.ok ? r.job.ver : ver;

    // --- มีคนแทรกแถวด้านบน แล้วกดติดตั้ง: ต้องเขียนลงแถวที่เลื่อนไป ---
    sh.insertRowBefore(R);
    SpreadsheetApp.flush();
    var bBefore = sh.getRange(R + 1, ctx.col.statusB + 1).getValue();
    r = call(plMarkInstalled_, OPS, key, { photoUrls: ["https://drive.google.com/test-photo-1"] }, ver);
    check("แถวเลื่อน → ยังเขียนถูกแถว (" + (R + 1) + ")", r.ok && r.job.row === R + 1 &&
      sh.getRange(R + 1, ctx.col.status + 1).getValue() === Config.STATUS.INSTALLED &&
      plStr_(sh.getRange(R, ctx.col.status + 1).getValue()) === "", r);
    check("มีรูป → ติ๊กคอลัมน์ B", r.ok && sh.getRange(R + 1, ctx.col.statusB + 1).getValue() === true, { before: bBefore });
    var logTail = plSheet_(Config.SHEET_LOG).getRange(plSheet_(Config.SHEET_LOG).getLastRow() - 4, 1, 5, 8).getDisplayValues();
    check("Log บันทึกว่า Ops กดแทน Installer", logTail.some(function (x) { return x[7].indexOf("Ops กดแทน Installer") >= 0; }), logTail);
    sh.deleteRow(R);
    SpreadsheetApp.flush();
    ver = r.ok ? r.job.ver : ver;

    // --- ส่ง Proof ---
    r = call(plMarkProofSent_, AE, key, ver);
    check("ยังไม่ On air ส่ง Proof ไม่ได้", code(r) === "BAD_STATE", r);
    sh.getRange(R, ctx.col.status + 1).setValue(Config.STATUS.ON_AIR);       // จำลองตัวตั้งเวลาเฟส ง
    r = call(plMarkProofSent_, AE, key, ver);
    check("On air → ส่ง Proof → ปิดงาน", r.ok && r.job.status === Config.STATUS.CLOSED && !!r.job.proofAt, r);

    // --- อ่านรายการ / รายละเอียด ---
    var lst = call(plListPosterJobs_, AE, { month: "2026-11" });
    var mine = lst.ok && lst.jobs.filter(function (j) { return j.row === R; })[0];
    check("listPosterJobs เห็นงานทดสอบ", !!mine && mine.status === Config.STATUS.CLOSED, lst.ok ? lst.jobs.length : lst);
    check("listPosterJobs จัดกลุ่มลูกค้า+สัปดาห์", lst.ok && lst.groups.length > 0 && !!mine.week, lst.ok && lst.groups.slice(0, 2));
    var gj = call(plGetJob_, AE, key);
    check("getJob มีประวัติจาก Log", gj.ok && gj.history.length >= 10, gj.ok ? gj.history.length : gj);
    check("SLA: เวลาสร้างงานอ่านจาก Log", !!mine && !!mine.createdAt, mine && mine.createdAt);

    // --- ตรวจวัน เขียว/เหลือง/แดง ---
    check("เขียว", plEvaluate_({ shipDate: "2026-11-15", installDate: "2026-11-19", adOn: "2026-11-20" }, 2).level === "green");
    check("เหลือง (ส่งชิดเกิน buffer)", plEvaluate_({ shipDate: "2026-11-18", installDate: "2026-11-19", adOn: "2026-11-20" }, 2).level === "yellow");
    check("แดง (ติดตั้งหลัง Ad on)", plEvaluate_({ shipDate: "2026-11-18", installDate: "2026-11-21", adOn: "2026-11-20" }, 2).level === "red");

    // --- ป้ายซ้ำในเดือนเดียวกัน / เดือนเก่า / หาไม่เจอ ---
    var signCell = sh.getRange(R2, ctx.col.sign + 1), signOrig = signCell.getValue();
    signCell.setValue(key.signCode);
    r = call(plGetJob_, AE, { row: 4, signCode: key.signCode, month: "2026-11" });
    check("ป้ายซ้ำเดือนเดียวกัน + แถวไม่ตรง → AMBIGUOUS", code(r) === "AMBIGUOUS", r);
    signCell.setValue(signOrig);
    r = call(plGetJob_, AE, { row: R, signCode: key.signCode, month: "2026-11" });
    check("คืนรหัสป้ายแล้ว หาเจอปกติ", r.ok && r.job.row === R, r);
    r = call(plGetJob_, AE, { row: R, signCode: "ZZZ-NOPE-99", month: "2026-11" });
    check("ป้ายที่ไม่มี → NOT_FOUND", code(r) === "NOT_FOUND", r);
    if (old) {
      var oj = plRowToJob_(ctx, plReadRow_(ctx, old), old);
      r = call(plCreateJob_, AE, oj.rowKey, { adOn: "2026-10-20" }, oj.ver);
      check("แถวเดือนเก่า → OLD_ROW (ไม่แตะ)", code(r) === "OLD_ROW", r);
    }
    var sto = call(plGetShipToOptions_, OPS, key.signCode.slice(0, 3));
    check("getShipToOptions คืนค่า", sto.ok && typeof sto.buffer === "number", sto);
  } catch (e) {
    results.push("ERROR " + (e && e.stack ? e.stack : e));
  } finally {
    Config.SPREADSHEET_ID = realId;
  }
  var fails = results.filter(function (s) { return s.indexOf("FAIL") === 0 || s.indexOf("ERROR") === 0; }).length;
  var passes = results.filter(function (s) { return s.indexOf("PASS") === 0; }).length;
  console.log(results.join("\n") + "\n==== สรุป: ผ่าน " + passes + " · ไม่ผ่าน " + fails);
  return { passes: passes, fails: fails };
}

/* ---------------------------------------------------------------------
 * โหมดทดสอบหน้าจอ (/dev): ให้ระบบ Poster Logistics อ่าน/เขียนสำเนาชีต + โฟลเดอร์รูปทดสอบ
 * plUiTestOn()  → ตั้ง PL_UI_TEST_SPREADSHEET_ID และสร้าง/ตั้ง PHOTO_FOLDER_ID เป็นโฟลเดอร์ทดสอบ (ครั้งแรกจะขอสิทธิ์ Drive)
 * plUiTestOff() → ลบทั้งสองค่า (ต้องรันก่อน deploy จริง)
 * ------------------------------------------------------------------- */
var PL_TEST_PHOTO_FOLDER_NAME = "[TEST] รูป Poster Logistics - ลบได้";

function plUiTestOn() {
  plRequireAdminCaller_();
  var p = PropertiesService.getScriptProperties();
  p.setProperty("PL_UI_TEST_SPREADSHEET_ID", PL_TEST_SPREADSHEET_DEFAULT);
  var it = DriveApp.getRootFolder().getFoldersByName(PL_TEST_PHOTO_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(PL_TEST_PHOTO_FOLDER_NAME);
  p.setProperty("PL_TEST_PHOTO_FOLDER_ID", folder.getId());
  if (!p.getProperty("PHOTO_FOLDER_ID")) p.setProperty("PHOTO_FOLDER_ID", folder.getId());
  console.log("โหมดทดสอบหน้าจอ: เปิด · สำเนาชีต " + PL_TEST_SPREADSHEET_DEFAULT + " · โฟลเดอร์รูป " + p.getProperty("PHOTO_FOLDER_ID"));
}

function plUiTestOff() {
  plRequireAdminCaller_();
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty("PL_UI_TEST_SPREADSHEET_ID");
  if (p.getProperty("PHOTO_FOLDER_ID") && p.getProperty("PHOTO_FOLDER_ID") === p.getProperty("PL_TEST_PHOTO_FOLDER_ID")) p.deleteProperty("PHOTO_FOLDER_ID");
  console.log("โหมดทดสอบหน้าจอ: ปิด · PHOTO_FOLDER_ID = " + (p.getProperty("PHOTO_FOLDER_ID") || "(ไม่ได้ตั้ง)"));
}

/* ---------------------------------------------------------------------
 * ทดสอบอัปโหลดรูป + ติดตั้งแล้ว (ฝั่ง server) บนสำเนา — ต้องเปิด plUiTestOn ก่อน
 * ใช้งานป้าย UTH-LBC-01 เดือน 2026-11 ที่อยู่สถานะ "รับของแล้ว" (สร้างจากการลองหน้าจอ)
 * ------------------------------------------------------------------- */
var PL_TEST_TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAkADADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHSTs/51KVyMjkVWqSKRkYDqCeRXpzg94nApdyQrQFrtP+EJBGft+M/wDTL/69H/CEgDP2/p/0y/8Ar1y+2Rt7JnGYCjJ4FQu+7gcCiV2dznseBTK64QtqzBvsFKv3h9aOtTRxhfmfk+lVKSihJXPYVI2jkdKGI2nkdK8kMzH+I/nQJmH8R/OvO9kzs9qim33j9aSrMiLJ8w4b+dVyCpwRg16MJqSORxsSxgBcjqaUnr/n1/woorJ/EylsB/z+tAoopAAPT/PpSkBhg0UUnuM//9k=";

function plTestUpload() {
  plRequireAdminCaller_();
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty("PL_UI_TEST_SPREADSHEET_ID")) throw new Error("ต้องรัน plUiTestOn ก่อน");
  if (p.getProperty("PHOTO_FOLDER_ID") !== p.getProperty("PL_TEST_PHOTO_FOLDER_ID")) throw new Error("PHOTO_FOLDER_ID ไม่ใช่โฟลเดอร์ทดสอบ");
  Config.SPREADSHEET_ID = PL_TEST_SPREADSHEET_DEFAULT;
  var out = [];
  function check(name, cond, detail) { out.push((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  → " + JSON.stringify(detail))); }
  function call(fn) { var a = [].slice.call(arguments, 1); return plApi_(function () { return fn.apply(null, a); }); }
  function code(r) { return r && r.ok ? "OK" : (r && r.code); }
  var INS = { email: "ins@test", name: "Ins", role: "Installer" }, AE = { email: "ae@test", name: "AE", role: "AE" };

  var ctx = plJobsCtx_(), sh = ctx.sheet;
  var all = sh.getRange(Config.DATA_START_ROW, 1, sh.getLastRow() - Config.DATA_START_ROW + 1, ctx.width).getValues();
  var R = 0;
  all.forEach(function (v, i) {
    if (!R && plStr_(v[ctx.col.sign]).toUpperCase() === "UTH-LBC-01" && plMonthKey_(v[ctx.col.year], v[ctx.col.month]) === "2026-11") R = i + Config.DATA_START_ROW;
  });
  if (!R) throw new Error("ไม่พบ UTH-LBC-01 เดือน 2026-11 ในสำเนา");
  var job = plRowToJob_(ctx, plReadRow_(ctx, R), R);
  out.push("INFO แถว " + R + " สถานะ " + job.status);

  var r = call(plUploadJobPhoto_, AE, job.rowKey, { dataUrl: PL_TEST_TINY_JPEG });
  check("AE อัปโหลดรูปไม่ได้", code(r) === "FORBIDDEN", r);
  r = call(plUploadJobPhoto_, INS, job.rowKey, { dataUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
  check("GIF ไม่รับ", code(r) === "INVALID", r);
  r = call(plUploadJobPhoto_, INS, job.rowKey, { dataUrl: "data:image/jpeg;base64," + Utilities.base64Encode(new Array(400).join("x")) });
  check("ไฟล์ปลอมชื่อ jpeg ไม่รับ", code(r) === "INVALID", r);
  var t0 = Date.now();
  r = call(plUploadJobPhoto_, INS, job.rowKey, { dataUrl: PL_TEST_TINY_JPEG, kind: "ติดตั้ง" });
  check("Installer อัปโหลดรูปจริงได้", r.ok && /drive\.google\.com\/file\/d\//.test(r.url), r);
  out.push("INFO อัปโหลดใช้เวลา " + (Date.now() - t0) + " ms");
  if (r.ok) {
    var f = DriveApp.getFileById(r.id);
    var parent = f.getParents().next();
    check("ไฟล์อยู่ในโฟลเดอร์ย่อยชื่อป้าย ใต้โฟลเดอร์ทดสอบ", parent.getName() === "UTH-LBC-01" && parent.getParents().next().getId() === p.getProperty("PL_TEST_PHOTO_FOLDER_ID"), parent.getName());
    check("ชนิดไฟล์ image/jpeg", f.getMimeType() === "image/jpeg", f.getMimeType());
  }
  if (job.status === Config.STATUS.RECEIVED && r.ok) {
    t0 = Date.now();
    var r2 = call(plMarkInstalled_, INS, job.rowKey, { photoUrls: [r.url], checklist: ["ทดสอบ"] }, job.ver);
    out.push("INFO ติดตั้งแล้วใช้เวลา " + (Date.now() - t0) + " ms");
    check("ติดตั้งแล้ว → สถานะติดตั้งแล้ว", r2.ok && r2.job.status === Config.STATUS.INSTALLED, r2);
    check("มีรูป → ติ๊กคอลัมน์ B ในชีต", sh.getRange(R, ctx.col.statusB + 1).getValue() === true, sh.getRange(R, ctx.col.statusB + 1).getValue());
    check("ลิงก์รูปเก็บในชีต", String(sh.getRange(R, ctx.col.photos + 1).getValue()).indexOf(r.id) >= 0, sh.getRange(R, ctx.col.photos + 1).getValue());
  } else out.push("INFO ข้ามขั้นติดตั้ง (สถานะไม่ใช่ รับของแล้ว)");
  var fails = out.filter(function (l) { return /^FAIL/.test(l); }).length;
  console.log(out.join("\n") + "\n==== สรุป: ไม่ผ่าน " + fails);
}

/* ---------------------------------------------------------------------
 * ทดสอบเฟส ง บนสำเนา — ต้องเปิด plUiTestOn ก่อน (อีเมลจะถูกส่งไปที่เจ้าของสคริปต์แทน และหัวเรื่องมี [TEST])
 * ใช้ผู้ใช้จำลอง (ใส่ใน cache ชั่วคราว ไม่แก้แท็บ Users) แล้วล้าง cache คืนตอนจบ
 *  - plTestPhaseD()       : onEdit คอลัมน์ B (จำลอง event) — ไม่ส่งอีเมล
 *  - plTestPhaseDNotify() : สรุป 08:00 + รายชั่วโมง + trigger — ส่งอีเมลจริงราว 5 ฉบับ (ส่งแทนมาที่เจ้าของสคริปต์)
 * ------------------------------------------------------------------- */
function plTestDEnv_(need) {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty("PL_UI_TEST_SPREADSHEET_ID")) throw new Error("ต้องรัน plUiTestOn ก่อน");
  Config.SPREADSHEET_ID = PL_TEST_SPREADSHEET_DEFAULT;
  if (!plIsTestMode_()) throw new Error("ไม่ได้อยู่ในโหมดทดสอบ");
  var T = { p: p, out: [], S: Config.STATUS };
  T.check = function (name, cond, detail) { T.out.push((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  → " + JSON.stringify(detail))); };
  T.call = function (fn) { var a = [].slice.call(arguments, 1); return plApi_(function () { return fn.apply(null, a); }); };
  T.AE = { email: "ae@test", name: "AE", role: "AE" };
  T.OPS = { email: "ops@test", name: "Ops", role: "Ops" };
  T.INS = { email: "ins@test", name: "Ins", role: "Installer" };
  T.MA = { email: "ma@test", name: "MA", role: "MA" };
  T.ADMIN = { email: "admin@test", name: "Admin", role: "Admin" };
  var fakeUsers = { "ae@test": { name: "AE", role: "AE" }, "ops@test": { name: "Ops", role: "Ops" }, "prod@test": { name: "Prod", role: "Production" },
    "ins@test": { name: "Ins", role: "Installer" }, "ma@test": { name: "MA", role: "MA" }, "admin@test": { name: "Admin", role: "Admin" } };
  CacheService.getScriptCache().put("pl_users_v1", JSON.stringify(fakeUsers), 900);
  T.ss = SpreadsheetApp.openById(PL_TEST_SPREADSHEET_DEFAULT);
  var ctx = T.ctx = plJobsCtx_(), sh = T.sh = ctx.sheet;
  T.colB = ctx.col.statusB + 1;
  var zone = plSystemZone_(ctx);
  T.reset = function (row) {            // คืนแถวทดสอบ: เอาติ๊กออก ลบ note ล้างคอลัมน์ที่ระบบดูแล (AQ–BC)
    sh.getRange(row, T.colB).setValue(false);
    sh.getRange(row, ctx.col.photos + 1).clearNote();
    if (zone[1] > zone[0]) sh.getRange(row, zone[0] + 1, 1, zone[1] - zone[0] + 1).clearContent();
    else ["status", "confirmedBy", "confirmedAt", "reason", "shippedAt", "tracking", "receivedAt", "condition", "installedAt", "photos", "proofAt", "updatedBy", "updatedAt"]
      .forEach(function (f) { if (ctx.col[f] >= 0) sh.getRange(row, ctx.col[f] + 1).clearContent(); });
  };
  T.job = function (row) { return plRowToJob_(ctx, plReadRow_(ctx, row), row); };
  T.logHas = function (row, text) {
    var L = plSheet_(Config.SHEET_LOG), n = Math.min(60, L.getLastRow() - 1);
    return L.getRange(L.getLastRow() - n + 1, 1, n, 8).getDisplayValues().some(function (x) { return String(x[2]) === String(row) && x[7].indexOf(text) >= 0; });
  };
  T.has = function (plan, em, sec) { return !!(plan[em] && Object.keys(plan[em]).some(function (s) { return s.indexOf(sec) >= 0; })); };
  function readAll() { return sh.getRange(Config.DATA_START_ROW, 1, sh.getLastRow() - Config.DATA_START_ROW + 1, ctx.width).getValues(); }

  // ล้างงานทดสอบที่ค้างจากรอบก่อน (แถวเดือน 2026-11 ที่แก้ล่าสุดโดยผู้ใช้จำลอง @test และไม่มีรูป)
  var cleaned = [];
  readAll().forEach(function (v, i) {
    var mk = plMonthKey_(v[ctx.col.year], v[ctx.col.month]);
    if (mk === "2026-11" && /@test$/.test(plStr_(v[ctx.col.updatedBy])) && !plStr_(v[ctx.col.photos])) { T.reset(i + Config.DATA_START_ROW); cleaned.push(i + Config.DATA_START_ROW); }
  });
  if (cleaned.length) { SpreadsheetApp.flush(); T.out.push("INFO ล้างงานทดสอบค้างจากรอบก่อน แถว " + cleaned.join(", ")); }

  var all = readAll(), countBy = {};
  T.free = []; T.old = 0;
  all.forEach(function (v) {
    var mk = plMonthKey_(v[ctx.col.year], v[ctx.col.month]), sign = plStr_(v[ctx.col.sign]).toUpperCase();
    if (sign) countBy[sign + "|" + mk] = (countBy[sign + "|" + mk] || 0) + 1;
  });
  all.forEach(function (v, i) {
    var r = i + Config.DATA_START_ROW, mk = plMonthKey_(v[ctx.col.year], v[ctx.col.month]), sign = plStr_(v[ctx.col.sign]).toUpperCase();
    if (!sign) return;
    var team = plStr_(v[ctx.col.team]);
    if (mk === "2026-11" && !plStr_(v[ctx.col.status]) && v[ctx.col.statusB] !== true && !plStr_(v[ctx.col.photos]) && countBy[sign + "|" + mk] === 1 &&
      (!team || Config.INSTALL_TEAMS.indexOf(team) >= 0)) T.free.push(r);
    if (mk && mk < "2026-11" && !T.old) T.old = r;
  });
  if (T.free.length < need) throw new Error("แถวว่างเดือน 2026-11 ไม่พอ (" + T.free.length + " ต้องการ " + need + ")");
  T.finish = function (title) {
    var fails = T.out.filter(function (l) { return /^FAIL/.test(l); }).length;
    console.log(T.out.join("\n") + "\n==== " + title + ": ผ่าน " + T.out.filter(function (l) { return /^PASS/.test(l); }).length + " ไม่ผ่าน " + fails);
  };
  return T;
}

function plTestPhaseD() {
  plRequireAdminCaller_();
  var T = plTestDEnv_(2);
  var out = T.out, check = T.check, S = T.S, ctx = T.ctx, sh = T.sh, colB = T.colB, ss = T.ss, job = T.job, logHas = T.logHas;
  var AE = T.AE, OPS = T.OPS, INS = T.INS;
  var R = T.free[0], R2 = T.free[1], old = T.old;
  try {
    out.push("INFO แถวทดสอบ onEdit " + R + ", " + R2 + " · แถวเดือนเก่า " + old);
    function ev(row, oldV) { return { source: ss, range: sh.getRange(row, colB), oldValue: oldV, value: oldV === "TRUE" ? "FALSE" : "TRUE" }; }
    function evMulti(row) { return { source: ss, range: sh.getRange(row, colB, 1, 3) }; }      // แก้หลายช่อง: ชีตไม่ส่งค่าเดิมมา
    function setB(row, v) { sh.getRange(row, colB).setValue(v); }
    function getB(row) { return sh.getRange(row, colB).getValue(); }
    function setSt(row, v) { sh.getRange(row, ctx.col.status + 1).setValue(v); }
    function note(row) { return sh.getRange(row, ctx.col.photos + 1).getNote(); }

    // ----- ติ๊กช่องเดียว -----
    setB(R, true);
    var r = plHandleEditB_(ev(R, "FALSE"), INS);
    var j = job(R);
    check("ติ๊ก B มือ → ticked", r && r.rows[0].result === "ticked", r);
    check("สถานะ = ติดตั้งแล้ว (ยืนยันมือ)", j.status === S.INSTALLED_MANUAL, j.status);
    check("ไม่มีรูป → note ไม่มีรูปติดตั้ง ที่ AZ", note(R) === PL_NO_PHOTO_NOTE, note(R));
    check("toast เตือนไม่มีรูป", /ไม่มีรูป/.test(r.toast), r.toast);
    check("BB/BC อัปเดต", j.updatedBy === "ins@test" && !!j.updatedAt, [j.updatedBy, j.updatedAt]);
    check("ลง Log ติ๊กมือ + เตือนไม่มีรูป", logHas(R, "ติ๊ก Status ด้วยมือในชีต") && logHas(R, "เตือน: ติ๊ก Status แต่ไม่มีรูปติดตั้ง"), "");

    // ----- เอาติ๊กออก -----
    setB(R, false);
    r = plHandleEditB_(ev(R, "TRUE"), AE);
    check("AE เอาติ๊กออก → คืนค่า TRUE", r.rows[0].result === "reverted" && getB(R) === true, r);
    check("ลง Log ปฏิเสธ", logHas(R, "ปฏิเสธการเอาติ๊ก Status ออก"), "");

    setB(R, false);
    r = plHandleEditB_(ev(R, "TRUE"), OPS);
    check("Ops ไม่มีเหตุผลใน AT → คืนค่า", r.rows[0].result === "reverted" && getB(R) === true, r);

    // เหตุผลเก่าที่ระบบเขียนไว้จากขั้นตอนก่อน (มีใน Log) ใช้เอาติ๊กออกไม่ได้
    var oldReason = "เหตุผลเก่าจากขั้นตอนก่อน " + plNowToken_();
    sh.getRange(R, ctx.col.reason + 1).setValue(oldReason);
    withLock_(function () { appendLog_([{ email: "ops@test", row: R, sign: j.sign, col: PL_F.reason, oldVal: "", newVal: oldReason, action: "ทดสอบ: เหตุผลจากขั้นตอนก่อน" }]); });
    setB(R, false);
    r = plHandleEditB_(ev(R, "TRUE"), OPS);
    check("Ops ใช้เหตุผลเก่าใน AT → คืนค่า + บอกให้พิมพ์เหตุผลใหม่", r.rows[0].result === "reverted" && getB(R) === true && /เหตุผลใหม่/.test(r.toast), r);

    var newReason = "ทดสอบเอาติ๊กออก " + plNowToken_();
    sh.getRange(R, ctx.col.reason + 1).setValue(newReason);
    setB(R, false);
    r = plHandleEditB_(ev(R, "TRUE"), OPS);
    check("Ops พิมพ์เหตุผลใหม่ → เอาออกได้", r.rows[0].result === "unticked" && getB(R) === false, r);
    check("ลง Log เอาติ๊กออกพร้อมเหตุผล", logHas(R, "เอาติ๊ก Status ออก (Ops) · เหตุผล: " + newReason), "");

    // แถวที่ไม่ได้ติ๊กอยู่แล้วอย่างถูกต้อง โดนแก้หลายช่องทับ → ต้องไม่ถูกติ๊กกลับ
    r = plHandleEditB_(evMulti(R), AE);
    check("หลายช่อง: แถวที่ Ops เอาติ๊กออกถูกต้อง ไม่ถูกติ๊กกลับ", r.rows[0].result === "no-change" && getB(R) === false, r);

    setB(R, true);
    r = plHandleEditB_(ev(R, "FALSE"), OPS);
    check("ติ๊กกลับ → ลง Log", r.rows[0].result === "reticked" && logHas(R, "ติ๊ก Status กลับในชีต"), r);

    r = plHandleEditB_(evMulti(R), AE);
    check("หลายช่อง: แถวที่ติ๊กอยู่แล้ว → ไม่ทำอะไร", r.rows[0].result === "no-change" && getB(R) === true, r);

    setB(R, false);
    r = plHandleEditB_(evMulti(R), AE);
    check("หลายช่อง: AE เอาติ๊กออก → ยังจับได้และคืนค่า", r.rows[0].result === "reverted" && getB(R) === true, r);

    // ----- แถวเดือนเก่า -----
    var L = plSheet_(Config.SHEET_LOG), logBefore = L.getLastRow();
    var oldB = getB(old), oldJob = job(old), oldNote = note(old);
    setB(old, oldB !== true);
    r = plHandleEditB_(ev(old, oldB === true ? "TRUE" : "FALSE"), AE);
    var oldAfter = job(old);
    check("แถวเดือนเก่า → ไม่แตะ", r.rows[0].result === "skip-old" && oldAfter.status === oldJob.status && getB(old) === (oldB !== true), r);
    check("แถวเดือนเก่า → ไม่ใส่ note ไม่ลง Log", note(old) === oldNote && L.getLastRow() === logBefore, [note(old), L.getLastRow(), logBefore]);
    setB(old, oldB);

    r = plHandleEditB_({ source: ss, range: sh.getRange(R, colB + 1), oldValue: "", value: "x" }, OPS);
    check("แก้คอลัมน์อื่น → ไม่ทำอะไร", r === null, r);

    // event จากไฟล์อื่น (ชีตจริง) ขณะระบบชี้สำเนา → ต้องไม่ทำอะไร (แค่อ่านช่วง ไม่เขียนชีตจริง)
    var realSheet = SpreadsheetApp.openById(PL_REAL_SPREADSHEET_ID_).getSheetByName(Config.SHEET_JOBS);
    r = plHandleEditB_({ range: realSheet.getRange(R, colB), oldValue: "FALSE", value: "TRUE" }, INS);
    check("event จากไฟล์อื่น → ไม่ทำอะไร", r === null, r);

    // ----- งานที่กด "ติดตั้งแล้ว" ในแอปแบบไม่มีรูป (สถานะติดตั้งแล้ว แต่ B ไม่ติ๊ก) -----
    setSt(R2, S.INSTALLED);
    r = plHandleEditB_(evMulti(R2), AE);
    check("หลายช่อง: งานติดตั้งแล้วไม่มีรูป (B ว่างอยู่เดิม) ไม่ถูกติ๊กให้", r.rows[0].result === "no-change" && getB(R2) !== true, r);
    setB(R2, true);
    r = plHandleEditB_(ev(R2, "FALSE"), INS);
    j = job(R2);
    check("ติ๊กมือบนงานติดตั้งแล้วไม่มีรูป → ยืนยันมือ + เตือนไม่มีรูป", r.rows[0].result === "reticked" && j.status === S.INSTALLED_MANUAL && note(R2) === PL_NO_PHOTO_NOTE &&
      logHas(R2, "เตือน: ติ๊ก Status แต่ไม่มีรูปติดตั้ง"), [r, j.status, note(R2)]);
    T.reset(R2);

    // ----- ติ๊กค้างอยู่ก่อนบนแถวที่ยังไม่มีงานในระบบ แล้วโดนแก้หลายช่องทับ → ไม่เดา -----
    setB(R2, true);
    r = plHandleEditB_(evMulti(R2), INS);
    check("หลายช่อง: ติ๊กอยู่แต่ยังไม่มีงานในระบบ → ไม่เปลี่ยนสถานะ + แจ้งเตือน", r.rows[0].result === "skip-unknown" && !job(R2).status && /ทีละช่อง/.test(r.toast), r);
    T.reset(R2);

    // ----- ติ๊กหลายแถวพร้อมกันบนงานที่อยู่ในระบบ -----
    setSt(R2, S.RECEIVED);
    setB(R2, true);
    r = plHandleEditB_({ source: ss, range: sh.getRange(R2 - 1, colB, 2, 3) }, INS);
    check("หลายแถว: งานในระบบที่ถูกติ๊ก → ยืนยันมือ", r && r.rows.length === 2 && r.rows[1].result === "ticked" && job(R2).status === S.INSTALLED_MANUAL, r);
    out.push("INFO แถวข้างเคียง " + (R2 - 1) + " → " + r.rows[0].result);
    T.reset(R2);

    // ----- ผ่านตัว trigger จริง plOnEditB (จำลอง e.user) -----
    setB(R2, true);
    plOnEditB({ source: ss, range: sh.getRange(R2, colB), oldValue: "FALSE", value: "TRUE", user: { getEmail: function () { return "INS@test"; } } });
    j = job(R2);
    check("plOnEditB: อ่านอีเมลคนแก้จาก event → ยืนยันมือ", j.status === S.INSTALLED_MANUAL && j.updatedBy === "ins@test", [j.status, j.updatedBy]);
    setB(R2, false);
    plOnEditB({ source: ss, range: sh.getRange(R2, colB), oldValue: "TRUE", value: "FALSE" });
    check("plOnEditB: ไม่รู้ว่าใครแก้ → เอาติ๊กออกไม่ได้ คืนค่า", getB(R2) === true && logHas(R2, "ไม่มีในรายชื่อ"), getB(R2));
  } catch (e) {
    out.push("FAIL ข้อผิดพลาด: " + (e.stack || e));
  } finally {
    try { [R, R2].forEach(T.reset); } catch (e2) { out.push("FAIL คืนค่าแถวทดสอบไม่สำเร็จ: " + e2); }
    plClearUsersCache();
  }
  T.finish("สรุป onEdit");
}

function plTestPhaseDNotify() {
  plRequireAdminCaller_();
  var T = plTestDEnv_(5);
  var out = T.out, check = T.check, call = T.call, S = T.S, ctx = T.ctx, sh = T.sh, colB = T.colB, job = T.job, logHas = T.logHas, has = T.has, p = T.p;
  var AE = T.AE, OPS = T.OPS, INS = T.INS, MA = T.MA, ADMIN = T.ADMIN;
  var hourlyKey = plHourlyKey_(), digestKey = plDigestKey_();
  var savedHourly = p.getProperty(hourlyKey), savedDigest = p.getProperty(digestKey);
  var origEffective = plEffectiveEmail_;
  try {
    var me = Session.getEffectiveUser().getEmail();

    // ===== โหมดทดสอบแต่ไม่รู้อีเมลปลายทาง → ต้องไม่ส่งเลย =====
    if (!Config.prop("NOTIFY_REDIRECT_TO")) {
      plEffectiveEmail_ = function () { return ""; };
      var fb = plMailbox_();
      fb.add(["nobody@test"], "ทดสอบ", "ทดสอบ");
      var fr;
      try { fr = plSendMailbox_(fb, "ทดสอบ fail-closed", "ทดสอบ", {}); } finally { plEffectiveEmail_ = origEffective; }
      check("โหมดทดสอบ + ไม่รู้อีเมลปลายทาง → ไม่ส่งเลย", fr.sent === 0 && !!fr.blocked && !plMailComplete_(fr), fr);
    } else out.push("INFO ข้ามทดสอบ fail-closed (ตั้ง NOTIFY_REDIRECT_TO ไว้)");

    // ===== trigger =====
    var threw = false;
    try { plInstallTriggers(); } catch (e0) { threw = /โหมดทดสอบ/.test(e0.message); }
    check("plInstallTriggers ไม่ยอมทำในโหมดทดสอบ", threw, "");
    out.push("INFO trigger ของโปรเจกต์ตอนนี้: " + ScriptApp.getProjectTriggers().length + " ตัว");

    // ===== On air: เตรียมงาน "ติดตั้งแล้ว" (ไม่มีรูป) ที่ Ad on = 25 พ.ย. =====
    var X = "2026-11-25";
    var RO = T.free[0], kO = job(RO).rowKey;
    var o = call(plCreateJob_, AE, kO, { adOn: X }, "");
    if (o.ok) o = call(plPlanInstall_, MA, kO, { shipTo: "TEST จุดรับ", installDate: "2026-11-23" }, o.job.ver);
    if (o.ok) o = call(plSetShipDate_, ADMIN, kO, { shipDate: "2026-11-20" }, o.job.ver);
    if (o.ok) o = call(plMarkShipped_, OPS, kO, { tracking: "TEST-123" }, o.job.ver);
    if (o.ok) o = call(plMarkReceived_, OPS, kO, { condition: Config.CONDITIONS.filter(function (c) { return c !== "เสียหาย"; })[0] }, o.job.ver);
    if (o.ok) o = call(plMarkInstalled_, INS, kO, {}, o.job.ver);
    check("เตรียมงาน On air: ติดตั้งแล้ว ไม่มีรูป → B ไม่ติ๊ก", o.ok && o.job.status === S.INSTALLED && sh.getRange(RO, colB).getValue() !== true, o);
    out.push("INFO งาน On air = " + kO.signCode + " แถว " + RO);

    p.deleteProperty(digestKey);
    var dry = plDailyDigest_({ dryRun: true, today: X });
    check("dry-run: งานอยู่ในรายการ On air", dry.onAir.indexOf(kO.signCode) >= 0, dry);
    check("dry-run: ไม่เปลี่ยนชีต ไม่จำสถานะการส่ง", job(RO).status === S.INSTALLED && !p.getProperty(digestKey), job(RO).status);
    var dayBefore = plDailyDigest_({ dryRun: true, today: plDateKey_(plAddDays_(X, -1)) });
    check("ก่อนวัน Ad on → ยังไม่ On air", dayBefore.onAir.indexOf(kO.signCode) < 0, dayBefore.onAir);

    // โควต้าหมดในวันที่สลับ On air → เรื่อง "ส่ง Proof" ต้องไม่ตกหล่น
    var q0 = plDailyDigest_({ today: X, quota: 0 });
    check("โควต้าหมด: ยังสลับเป็น On air ในชีต", job(RO).status === S.ON_AIR, job(RO).status);
    check("โควต้าหมด: ไม่ได้ส่ง และยังไม่ถือว่าส่งครบ", q0.mail.sent === 0 && q0.mail.skipped.length >= 1 && q0.complete === false, q0);
    check("ลง Log On air", logHas(RO, "On air (ระบบเปลี่ยนเมื่อถึงวัน Ad on)"), "");
    var real = plDailyDigest_({ today: X });
    out.push("INFO ส่งจริง: " + JSON.stringify(real.mail) + " · แผน " + JSON.stringify(real.plan));
    check("รอบถัดไป: AE ยังได้เรื่องให้ส่ง Proof", has(real.plan, "ae@test", "On air แล้ว ยังไม่ได้กด"), real.plan);
    check("ส่งจริง: อีเมลถูกส่งแทนไปที่เจ้าของสคริปต์ และถือว่าส่งครบ", real.mail.redirectedTo === me && real.mail.sent >= 1 && !real.mail.errors.length && real.complete === true, real.mail);
    var again = plDailyDigest_({ today: X });
    check("รันซ้ำวันเดียวกัน → ไม่ส่งซ้ำ", !!again.skipped && again.mail.sent === 0, again);
    var lj2 = job(RO);
    var rp = call(plMarkProofSent_, AE, lj2.rowKey, lj2.ver);
    check("AE ส่ง Proof แล้ว → ปิดงาน", rp.ok && rp.job.status === S.CLOSED && !!rp.job.proofAt, rp);
    var afterClose = plDailyDigest_({ dryRun: true, today: plDateKey_(plAddDays_(X, 1)) });
    check("ปิดงานแล้ว → ไม่เตือนส่ง Proof อีก", !has(afterClose.plan, "ae@test", "On air"), afterClose.plan);

    // ===== สร้างงานทดสอบ แล้วตรวจ D-1 / เลยกำหนด / SLA / รายชั่วโมง =====
    var L = plSheet_(Config.SHEET_LOG), logFrom = L.getLastRow() + 1;
    var kA = job(T.free[1]).rowKey, kB = job(T.free[2]).rowKey, kC = job(T.free[3]).rowKey, kD = job(T.free[4]).rowKey;
    var a = call(plCreateJob_, AE, kA, { adOn: "2026-11-20" }, "");
    var c = a.ok ? call(plPlanInstall_, MA, kA, { shipTo: "TEST จุดรับ", installDate: "2026-11-18" }, a.job.ver) : a;
    check("งาน A: MA แจ้งแผน → รอกำหนดวันส่ง", c.ok && c.job.status === S.WAIT_SHIP, c);
    if (c.ok) c = call(plSetShipDate_, ADMIN, kA, { shipDate: "2026-11-16" }, c.job.ver);
    check("งาน A: Admin กำหนดวันส่ง → มีกำหนด", c.ok && c.job.status === S.SCHEDULED, c);
    var b = call(plCreateJob_, AE, kB, { adOn: "2026-11-17" }, "");
    var b2 = b.ok ? call(plPlanInstall_, MA, kB, { shipTo: "TEST จุดรับ", installDate: "2026-11-19", reason: "TEST ติดตั้งช้า" }, b.job.ver) : b;
    if (b2.ok) b2 = call(plSetShipDate_, ADMIN, kB, { shipDate: "2026-11-16" }, b2.job.ver);
    check("งานทดสอบ B แถวแดง → รอ AE", b2.ok && b2.job.status === S.WAIT_AE, b2);
    var c2 = c.ok ? call(plPlanInstall_, MA, kA, { shipTo: "TEST จุดรับ 2", installDate: "2026-11-18", reason: "TEST แก้แผน" }, c.job.ver) : c;
    check("MA แก้แผนงาน A หลังกำหนดการครบ", c2.ok && c2.job.status === S.SCHEDULED, c2);
    var cc = call(plCreateJob_, AE, kC, { adOn: "2026-11-30" }, "");
    check("สร้างงาน C (ทิ้งไว้ที่ รอ MA)", cc.ok && cc.job.status === S.WAIT_MA, cc);
    var dd = call(plCreateJob_, AE, kD, { adOn: "2026-11-28" }, "");
    if (dd.ok) dd = call(plPlanInstall_, MA, kD, { shipTo: "TEST จุดรับ", installDate: "2026-11-26" }, dd.job.ver);
    check("สร้างงาน D + MA แจ้งแผน (ทิ้งไว้ที่ รอกำหนดวันส่ง)", dd.ok && dd.job.status === S.WAIT_SHIP, dd);

    var d15 = plDailyDigest_({ dryRun: true, today: "2026-11-15" });
    check("D-1 วันส่ง → Production + Ops", has(d15.plan, "prod@test", "พรุ่งนี้ต้องส่ง") && has(d15.plan, "ops@test", "พรุ่งนี้ต้องส่ง"), d15.plan);
    check("D-1 วันส่ง ไม่ส่งให้ Installer", !has(d15.plan, "ins@test", "พรุ่งนี้ต้องส่ง"), d15.plan);
    var d17 = plDailyDigest_({ dryRun: true, today: "2026-11-17" });
    check("D-1 วันติดตั้ง → MA + Installer", has(d17.plan, "ins@test", "พรุ่งนี้ต้องติดตั้ง") && has(d17.plan, "ma@test", "พรุ่งนี้ต้องติดตั้ง"), d17.plan);
    check("รอกำหนดวันส่ง → Admin (งาน D)", has(d17.plan, "admin@test", "รอกำหนดวันส่ง") && !has(d17.plan, "ops@test", "รอกำหนดวันส่ง"), d17.plan);
    check("เลยวันส่ง → Ops", has(d17.plan, "ops@test", "เลยวันส่งแล้ว"), d17.plan);
    check("อีเมลรวมฉบับเดียวต่อคน", d17.mail.recipients.filter(function (e) { return e === "ops@test"; }).length === 1, d17.mail);
    out.push("INFO แผน 17 พ.ย.: " + JSON.stringify(d17.plan));

    var due = plDateKey_(plAddWorkdays_(new Date(), Config.SLA_WORKDAYS));
    var head = Config.prop("OPS_HEAD_EMAIL");
    var slaTo = head ? head.split(/[,\s]+/)[0].toLowerCase() : "ma@test";
    var dS0 = plDailyDigest_({ dryRun: true, today: due });
    var dS = plDailyDigest_({ dryRun: true, today: plDateKey_(plAddDays_(due, 1)) });
    function slaHas(res, em) {
      var bx = res.detail[em]; if (!bx) return false;
      return Object.keys(bx.sections).some(function (s) { return s.indexOf("MA ยังไม่แจ้งแผนติดตั้งเกิน") >= 0 && bx.sections[s].some(function (l) { return l.indexOf(kC.signCode) >= 0; }); });
    }
    check("วันครบกำหนด SLA → ยังไม่แจ้งงาน C", !slaHas(dS0, slaTo), dS0.plan);
    check("เลย SLA → แจ้งงาน C ถึง " + slaTo, slaHas(dS, slaTo), dS.plan);
    if (!head) check("ไม่ได้ตั้ง OPS_HEAD_EMAIL → ส่ง Admin ด้วย", slaHas(dS, "admin@test"), dS.plan);
    out.push("INFO SLA ครบกำหนด " + due + " · OPS_HEAD_EMAIL " + (head ? "ตั้งแล้ว" : "ยังไม่ได้ตั้ง"));

    // แถวเลื่อนหลังสร้างงาน: ยังต้องหาคนสร้าง/เวลาสร้างเจอจากรหัสป้าย · กำกวม → ไม่เดา
    var cidx = plCreationIndex_(), jc = job(T.free[3]);
    var moved = { row: jc.row + 1000, sign: jc.sign }, mk = {};
    mk[moved.row + "|" + moved.sign] = true;
    var found = plCreationOf_(cidx, moved, mk);
    check("แถวเลื่อน: ยังหาเวลาสร้าง/คนสร้างเจอจากรหัสป้าย", !!found && found.email === "ae@test" && !!found.at, found);
    check("ไม่มีใน Log เลย → ไม่เดา (null)", plCreationOf_(cidx, { row: 1, sign: "ไม่มีป้ายนี้" }, {}) === null, "");

    var h = plHourlyNotify_({ dryRun: true, fromRow: logFrom });
    out.push("INFO รายชั่วโมง: " + JSON.stringify(h.plan));
    check("รายชั่วโมง: งานใหม่ → MA", has(h.plan, "ma@test", "งานใหม่เข้าคิว"), h.plan);
    check("รายชั่วโมง: งานที่ MA แจ้งแผนไปแล้วในชั่วโมงเดียวกัน ไม่ขึ้นเป็นงานใหม่", (h.plan["ma@test"] || {})["งานใหม่เข้าคิว รอ MA แจ้งแผนติดตั้ง"] === 1, h.plan);
    check("รายชั่วโมง: MA แจ้งแผน → Admin (เฉพาะงานที่ยังรอวันส่ง)", (h.plan["admin@test"] || {})["MA แจ้งแผนติดตั้งแล้ว รอกำหนดวันส่ง"] === 1, h.plan);
    check("รายชั่วโมง: กำหนดการครบ → AE คนสร้าง + MA + Production", has(h.plan, "ae@test", "กำหนดการครบแล้ว") && has(h.plan, "ma@test", "กำหนดการครบแล้ว") && has(h.plan, "prod@test", "กำหนดการครบแล้ว"), h.plan);
    check("รายชั่วโมง: แถวแดง → AE", has(h.plan, "ae@test", "แถวแดง"), h.plan);
    check("รายชั่วโมง: MA แก้แผนหลังกำหนดการครบ → AE + Admin", has(h.plan, "ae@test", "แก้กำหนดการหลังกำหนดการครบแล้ว") && has(h.plan, "admin@test", "แก้กำหนดการหลังกำหนดการครบแล้ว"), h.plan);
    check("รายชั่วโมง: AE ได้ฉบับเดียว", h.mail.recipients.filter(function (e) { return e === "ae@test"; }).length === 1, h.mail);
    check("รายชั่วโมง dry-run: ไม่ส่งเมล", h.mail.sent === 0, h.mail);

    // รอบจริง: โควต้าเหลือ 1 ฉบับ → ส่งได้คนเดียว ต้องไม่เลื่อนตำแหน่ง แล้วรอบถัดไปส่งเฉพาะคนที่ค้าง
    p.setProperty(hourlyKey, String(logFrom - 1));          // รูปแบบเก่า (เลขแถวอย่างเดียว) ต้องยังอ่านได้
    var h1 = plHourlyNotify_({ quota: 1 });
    var st1 = plHourlyState_(hourlyKey);
    check("รายชั่วโมง โควต้าเหลือ 1: ส่ง 1 ที่เหลือค้าง ไม่เลื่อนตำแหน่ง", h1.mail.sent === 1 && h1.mail.skipped.length === h1.mail.recipients.length - 1 && h1.mail.skipped.length >= 1 && h1.advanced === false && st1.row === logFrom - 1, [h1, st1]);
    var h2 = plHourlyNotify_({});
    var st2 = plHourlyState_(hourlyKey);
    check("รอบถัดไป: ส่งเฉพาะคนที่ค้าง ไม่ส่งซ้ำคนที่ได้แล้ว", h2.mail.sent === h1.mail.skipped.length && h2.mail.sentTo.slice().sort().join() === h1.mail.skipped.slice().sort().join() && h2.mail.recipients.indexOf(h1.mail.sentTo[0]) < 0, h2);
    check("ส่งครบ → เลื่อนตำแหน่งถึงท้าย Log", h2.advanced === true && st2.row === h2.toRow && !!st2.ts, [h2.toRow, st2]);
    var h3 = plHourlyNotify_({});
    check("รอบถัดไปไม่มีเรื่องใหม่ → ไม่ส่ง", h3.mail.sent === 0 && h3.events === 0, h3);
    out.push("INFO อีเมลจริงรอบรายชั่วโมง: " + JSON.stringify(h1.mail.sentTo.concat(h2.mail.sentTo)) + " → ส่งแทนไปที่เจ้าของสคริปต์");
    out.push("INFO งานทดสอบ On air=" + kO.signCode + " A=" + kA.signCode + " B=" + kB.signCode + " C=" + kC.signCode + " D=" + kD.signCode + " (ทิ้งไว้ในสำเนา รอบหน้าล้างเอง)");
  } catch (e) {
    out.push("FAIL ข้อผิดพลาด: " + (e.stack || e));
  } finally {
    plEffectiveEmail_ = origEffective;
    if (savedHourly == null) p.deleteProperty(hourlyKey); else p.setProperty(hourlyKey, savedHourly);
    if (savedDigest == null) p.deleteProperty(digestKey); else p.setProperty(digestKey, savedDigest);
    plClearUsersCache();
  }
  T.finish("สรุปแจ้งเตือน");
}

// ตั้งเฉพาะ trigger onEdit บนสำเนา (ไว้ลองติ๊ก B ในหน้าชีตจริง ๆ) · ลบด้วย plRemoveTriggers
function plTestInstallEditTrigger() {
  plRequireAdminCaller_();
  if (!PropertiesService.getScriptProperties().getProperty("PL_UI_TEST_SPREADSHEET_ID")) throw new Error("ต้องรัน plUiTestOn ก่อน");
  return plInstallTriggers_("edit");
}
