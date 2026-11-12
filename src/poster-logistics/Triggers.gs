/* =====================================================================
 * Poster Logistics — เฟส ง: onEdit (installable) ของคอลัมน์ B "Status" ในแท็บ 2026
 *  - ติ๊ก B ด้วยมือ (FALSE→TRUE): AQ = "ติดตั้งแล้ว (ยืนยันมือ)" + Log · ถ้า AZ ว่าง ใส่ note เตือน "ไม่มีรูปติดตั้ง"
 *  - เอาติ๊กออก (TRUE→FALSE): ทำได้เฉพาะ Ops/Admin ที่ใส่เหตุผลใหม่ใน AT · คนอื่น → ติ๊กกลับเป็น TRUE + Log
 *  - แถวเดือนก่อน GO_LIVE_MONTH: ไม่แตะเลย
 *
 * รู้ได้อย่างไรว่าช่องไหน "เพิ่งถูกแก้":
 *  - แก้ช่องเดียว → ใช้ค่าเดิมที่ชีตส่งมา (e.oldValue)
 *  - แก้หลายช่องพร้อมกัน (วาง/ลาก/เลือกหลายช่องแล้วกด) ชีตไม่บอกค่าเดิม:
 *      ยังไม่มีงานในระบบ → ไม่รู้ ไม่แตะแถวนั้น (ไม่เดา) · งานในระบบที่ยังไม่ติดตั้ง → เดิมไม่ได้ติ๊ก
 *      งานที่ติดตั้งแล้ว → ดูค่า B ล่าสุดที่ระบบบันทึกใน Log (นับจากการสร้างงานครั้งล่าสุด) ไม่มีค่อยอนุมานจากสถานะ/รูป
 * หมายเหตุ: installable onEdit ไม่ทำงานกับการแก้ผ่าน API/สคริปต์ — ทำงานเฉพาะคนแก้ในหน้าชีต
 * ===================================================================== */

var PL_NO_PHOTO_NOTE = "ไม่มีรูปติดตั้ง";

// trigger เรียกตัวนี้ (ตั้งด้วย plInstallTriggers)
function plOnEditB(e) {
  // event จริงจากชีตมี range เป็น object ที่มีเมธอด · ค่าที่ส่งมาจาก google.script.run เป็น JSON ล้วน → ไม่ผ่าน
  if (!e || !e.range || typeof e.range.getRow !== "function" || typeof e.range.getSheet !== "function") return;
  // ใช้อีเมลของ "คนที่แก้" จาก event เท่านั้น · ถ้าชีตไม่ส่งมา ถือว่าไม่รู้ว่าใคร (เอาติ๊กออกไม่ได้)
  var email = "";
  try { email = String((e.user && e.user.getEmail && e.user.getEmail()) || "").trim().toLowerCase(); } catch (x) { }
  var lastErr = null, r = null, ok = false;
  for (var attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      var u = email ? plUsers_()[email] : null;
      r = plHandleEditB_(e, { email: email, name: u ? u.name : "", role: u ? u.role : "" });
      ok = true;
    } catch (err) {
      lastErr = err;
      if (err.code !== "BUSY") break;          // มีคนกำลังบันทึกอยู่ → รอแล้วลองใหม่
      Utilities.sleep(1500);
    }
  }
  if (ok) {
    try { if (r && r.toast && e.source) e.source.toast(r.toast, "Poster Logistics", 8); } catch (x1) { }
    return r;
  }
  // จัดการไม่สำเร็จ: ต้องมีร่องรอยใน Log เสมอ (appendRow เป็นการเขียนแบบ atomic ใช้ได้แม้ไม่ได้ lock)
  var msg = String((lastErr && (lastErr.userMessage || lastErr.message)) || lastErr);
  console.error(lastErr && lastErr.stack ? lastErr.stack : lastErr);
  try {
    plSheet_(Config.SHEET_LOG).appendRow([Utilities.formatDate(new Date(), Config.TZ, "yyyy-MM-dd HH:mm:ss"), email || "(ไม่ทราบอีเมลผู้แก้)",
      e.range.getRow(), "", PL_F.statusB, "", "", "ระบบจัดการการแก้คอลัมน์ Status ไม่สำเร็จ (ช่วง " + e.range.getA1Notation() + "): " + msg]);
  } catch (x2) { console.error(x2); }
  try { if (e.source) e.source.toast("ระบบบันทึกการแก้คอลัมน์ Status ไม่สำเร็จ: " + msg + " — กรุณาแจ้งผู้ดูแล", "Poster Logistics", 10); } catch (x3) { }
  return null;
}

// แยกจาก trigger เพื่อให้ชุดทดสอบส่ง user จำลองได้ · คืน { rows:[{row, result}], toast } หรือ null ถ้าไม่เกี่ยว
// result: ticked / reticked / unticked / reverted / no-change / skip-old / skip-unknown
function plHandleEditB_(e, user) {
  var range = e.range;
  var sheet = range.getSheet();
  if (sheet.getName() !== Config.SHEET_JOBS) return null;
  // ต้องเป็นไฟล์เดียวกับที่ระบบใช้อยู่ตอนนี้ (สำเนามีรหัสแท็บ gid เหมือนต้นฉบับ จึงต้องเทียบรหัสไฟล์)
  if (sheet.getParent().getId() !== plSpreadsheetId_()) return null;
  var r0 = range.getRow(), r1 = range.getLastRow();
  var c0 = range.getColumn(), c1 = range.getLastColumn();
  if (r1 < Config.DATA_START_ROW) return null;

  var ctx = plJobsCtx_();
  if (ctx.sheet.getSheetId() !== sheet.getSheetId()) return null;
  var colB = ctx.col.statusB + 1;
  if (ctx.col.statusB < 0 || colB < c0 || colB > c1) return null;
  var single = r0 === r1 && c0 === c1;

  return withLock_(function () {
    var first = Math.max(r0, Config.DATA_START_ROW);
    var n = r1 - first + 1;
    var vals = ctx.sheet.getRange(first, 1, n, ctx.width).getValues();
    var out = [], logs = [], toasts = [], unknown = 0;
    var who = user.email || "(ไม่ทราบอีเมลผู้แก้)";
    var canUntick = user.role === "Admin" || user.role === "Ops";

    // ค่า B และเหตุผล ล่าสุดที่ระบบเคยบันทึกใน Log ของแต่ละ "แถว|ป้าย" (อ่านเมื่อจำเป็น ครั้งเดียว)
    var logIdx = null;
    function logInfo(row, sign) {
      if (!logIdx) {
        logIdx = {};
        var L = plSheet_(Config.SHEET_LOG), last = L.getLastRow();
        if (last >= 2) L.getRange(2, 1, last - 1, 8).getDisplayValues().forEach(function (r) {
          // สร้างงานใหม่บนแถวเดิม = เริ่มรอบใหม่ ค่า B ที่บันทึกไว้ก่อนหน้านั้นไม่นับ
          if (r[7].indexOf("สร้างงาน") === 0 && logIdx[r[2] + "|" + r[3]]) delete logIdx[r[2] + "|" + r[3]].b;
          if (r[4] !== PL_F.statusB && r[4] !== PL_F.reason) return;
          var o = logIdx[r[2] + "|" + r[3]] || (logIdx[r[2] + "|" + r[3]] = {});
          if (r[4] === PL_F.reason) o.reason = r[6];
          else if (/^TRUE/i.test(r[6])) o.b = true;
          else if (/^FALSE/i.test(r[6])) o.b = false;
        });
      }
      return logIdx[row + "|" + sign] || {};
    }

    // ค่า B ก่อนการแก้ครั้งนี้: true / false / null (ไม่ทราบ)
    function prevB(job, row, installed) {
      if (single) {
        if (e.oldValue !== undefined && e.oldValue !== null) return String(e.oldValue).toUpperCase() === "TRUE";
        if (e.value !== undefined && e.value !== null) return false;       // ไม่มีค่าเดิม = ช่องเคยว่าง
      }
      // แก้หลายช่อง: ชีตไม่บอกค่าเดิม
      if (!job.status) return null;        // ยังไม่มีงานในระบบ → ไม่มีบันทึกที่เชื่อได้ (Log เก่าเป็นของรอบก่อน) ไม่เดา
      if (!installed) return false;        // งานในระบบที่ยังไม่ติดตั้ง: ทุกทางที่ติ๊ก B จะเปลี่ยนสถานะเป็นติดตั้งแล้วเสมอ จึงถือว่าเดิมไม่ได้ติ๊ก
      var li = logInfo(row, job.sign);     // ติดตั้งแล้ว: Ops อาจเอาติ๊กออกไว้ → ดูค่าล่าสุดใน Log
      if (li.b === true || li.b === false) return li.b;
      if (job.status === PL_S.INSTALLED_MANUAL) return true;               // สถานะนี้มาจากการติ๊กมือ
      if (job.status === PL_S.INSTALLED) return job.photoList.length > 0;  // แอปติ๊กให้เฉพาะเมื่อมีรูป
      return null;
    }

    function warnNoPhoto(base, job, row) {
      ctx.sheet.getRange(row, ctx.col.photos + 1).setNote(PL_NO_PHOTO_NOTE);
      logs.push(plObj_(base, { col: PL_F.photos, newVal: "note: " + PL_NO_PHOTO_NOTE, action: "เตือน: ติ๊ก Status แต่ไม่มีรูปติดตั้ง" }));
      toasts.push(job.sign + ": ติ๊กแล้วแต่ยังไม่มีรูปติดตั้ง");
    }

    vals.forEach(function (v, i) {
      var row = first + i;
      var job = plRowToJob_(ctx, v, row);
      if (!job.sign || !job.monthKey || job.monthKey < Config.GO_LIVE_MONTH) { out.push({ row: row, result: "skip-old" }); return; }
      var installed = PL_INSTALLED_SET.indexOf(job.status) >= 0;
      var base = { email: who, row: row, sign: job.sign };
      var prev = prevB(job, row, installed);
      var writes = {};

      if (job.statusB && !installed) {
        if (prev === true) { out.push({ row: row, result: "no-change" }); return; }
        if (prev === null) { unknown++; out.push({ row: row, result: "skip-unknown" }); return; }
        // ติ๊กด้วยมือ → ติดตั้งแล้ว (ยืนยันมือ)
        writes[ctx.col.status] = PL_S.INSTALLED_MANUAL;
        writes[ctx.col.updatedBy] = who;
        writes[ctx.col.updatedAt] = plNowToken_();
        if (!job.installedAt && ctx.col.installedAt >= 0) writes[ctx.col.installedAt] = plNowText_();
        var oldStatus = job.status;
        plWriteRow_(ctx.sheet, row, v, writes, plSystemZone_(ctx));
        logs.push(plObj_(base, { col: PL_F.statusB, oldVal: "FALSE", newVal: "TRUE", action: "ติ๊ก Status ด้วยมือในชีต" }));
        logs.push(plObj_(base, { col: PL_F.status, oldVal: oldStatus, newVal: PL_S.INSTALLED_MANUAL, action: "ติ๊ก Status ด้วยมือในชีต" }));
        if (!job.photoList.length) warnNoPhoto(base, job, row);
        out.push({ row: row, result: "ticked" });
      } else if (job.statusB && installed) {
        if (prev !== false) { out.push({ row: row, result: "no-change" }); return; }
        // ติ๊กบนงานที่สถานะเป็นติดตั้งแล้วอยู่แล้ว (แอปไม่ได้ติ๊กให้เพราะไม่มีรูป หรือ Ops เคยเอาติ๊กออก)
        logs.push(plObj_(base, { col: PL_F.statusB, oldVal: "FALSE", newVal: "TRUE", action: "ติ๊ก Status กลับในชีต" }));
        if (!job.photoList.length) {
          if (job.status === PL_S.INSTALLED) {          // ไม่มีรูปแต่คนยืนยันด้วยมือ → ถือเป็น "ยืนยันมือ"
            writes[ctx.col.status] = PL_S.INSTALLED_MANUAL;
            writes[ctx.col.updatedBy] = who;
            writes[ctx.col.updatedAt] = plNowToken_();
            plWriteRow_(ctx.sheet, row, v, writes, plSystemZone_(ctx));
            logs.push(plObj_(base, { col: PL_F.status, oldVal: PL_S.INSTALLED, newVal: PL_S.INSTALLED_MANUAL, action: "ติ๊ก Status กลับในชีต" }));
          }
          warnNoPhoto(base, job, row);
        }
        out.push({ row: row, result: "reticked" });
      } else if (!job.statusB && installed) {
        if (prev !== true) { out.push({ row: row, result: "no-change" }); return; }   // เดิมก็ไม่ได้ติ๊กอยู่แล้ว
        // เอาติ๊กออก: Ops/Admin + เหตุผลใหม่ใน AT (เหตุผลที่ระบบเขียนไว้จากขั้นตอนก่อนหน้า ไม่นับ)
        var reason = plStr_(job.reason);
        var li = logInfo(row, job.sign);
        var stale = !!reason && li.reason !== undefined && plStr_(li.reason) === reason;
        if (canUntick && reason && !stale) {
          logs.push(plObj_(base, { col: PL_F.statusB, oldVal: "TRUE", newVal: "FALSE", action: "เอาติ๊ก Status ออก (" + user.role + ") · เหตุผล: " + reason }));
          logs.push(plObj_(base, { col: PL_F.reason, oldVal: li.reason || "", newVal: reason, action: "เหตุผลเอาติ๊ก Status ออก (พิมพ์ในชีต)" }));
          (logIdx[row + "|" + job.sign] = logIdx[row + "|" + job.sign] || {}).reason = reason;
          out.push({ row: row, result: "unticked" });
        } else {
          ctx.sheet.getRange(row, colB).setValue(true);
          var why = !canUntick ? "เฉพาะ Ops/Admin เท่านั้น"
            : !reason ? "ต้องใส่เหตุผลในคอลัมน์ \"" + PL_F.reason + "\" ก่อน"
              : "เหตุผลในคอลัมน์ \"" + PL_F.reason + "\" เป็นของขั้นตอนก่อนหน้า ต้องพิมพ์เหตุผลใหม่สำหรับการเอาติ๊กออก";
          logs.push(plObj_(base, { col: PL_F.statusB, oldVal: "TRUE", newVal: "TRUE (คืนค่า)", action: "ปฏิเสธการเอาติ๊ก Status ออก: " + why + " (บทบาท " + (user.role || "ไม่มีในรายชื่อ") + ")" }));
          toasts.push(job.sign + ": เอาติ๊กออกไม่ได้ — " + why + " ระบบติ๊กกลับให้แล้ว");
          out.push({ row: row, result: "reverted" });
        }
      } else {
        out.push({ row: row, result: "no-change" });
      }
    });
    if (unknown) {
      toasts.push("มี " + unknown + " แถวที่ติ๊กอยู่แต่ยังไม่มีงานในระบบ และระบบไม่รู้ว่าเพิ่งติ๊กหรือติ๊กไว้ก่อน (แก้หลายช่องพร้อมกัน) จึงไม่เปลี่ยนสถานะให้ — ถ้าเพิ่งติ๊ก ให้ติ๊กทีละช่อง");
    }
    if (logs.length) {
      appendLog_(logs);
      try { if (typeof clearDashboardCache === "function") clearDashboardCache(Config.SHEET_JOBS); } catch (x) { }
    }
    return { rows: out, toast: toasts.join("\n") };
  });
}

function plObj_(a, b) {
  var o = {};
  Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  Object.keys(b).forEach(function (k) { o[k] = b[k]; });
  return o;
}
