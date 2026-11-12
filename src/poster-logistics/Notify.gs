/* =====================================================================
 * Poster Logistics — เฟส ง: แจ้งเตือนทางอีเมล + ตั้ง trigger
 *  - plDailyDigest()  : trigger ทุกวัน 08:00 (Asia/Bangkok) → สลับ On air + อีเมลสรุปฉบับเดียวต่อคน
 *  - plHourlyNotify() : trigger ทุกชั่วโมง → อ่าน Log ที่เพิ่มใหม่ แจ้ง "งานใหม่ / Ops ยืนยันแล้ว / แถวแดงรอ AE"
 *                       (รวมเป็นอีเมลฉบับเดียวต่อคนต่อรอบ ส่งเฉพาะเมื่อมีเรื่อง)
 *  - plInstallTriggers() / plRemoveTriggers() : ติดตั้ง/ลบ trigger ทั้งหมดของระบบนี้
 *
 * ความปลอดภัยตอนทดสอบ: ถ้าอยู่ในโหมดทดสอบ (ใช้สำเนาชีต) หรือมี Script Property NOTIFY_REDIRECT_TO
 * อีเมลทุกฉบับจะส่งไปที่ NOTIFY_REDIRECT_TO (หรือเจ้าของสคริปต์) แทน หัวเรื่องขึ้น [TEST] และระบุผู้รับจริงในเนื้อหา
 * ถ้าอยู่ในโหมดทดสอบแต่หาอีเมลปลายทางทดสอบไม่ได้ → ไม่ส่งเลย (ไม่ปล่อยให้หลุดไปถึงผู้รับจริง)
 * กันส่งซ้ำ/ตกหล่น: สรุป 08:00 จำว่าวันนี้ส่งให้ใครแล้ว (ส่งไม่ครบ รอบรายชั่วโมงจะส่งต่อให้คนที่ยังไม่ได้)
 *                   รอบรายชั่วโมงเลื่อนตำแหน่ง Log เมื่อส่งครบทุกคนเท่านั้น
 * Script Properties ที่ใช้: OPS_HEAD_EMAIL, NOTIFY_REDIRECT_TO (ไม่บังคับ), WEBAPP_URL (ไม่บังคับ)
 * ===================================================================== */

var PL_SYSTEM_USER = { email: "system/trigger", name: "ระบบ", role: "System" };
var PL_INSTALLED_SET = [Config.STATUS.INSTALLED, Config.STATUS.INSTALLED_MANUAL, Config.STATUS.ON_AIR, Config.STATUS.CLOSED];
var PL_NOT_SHIPPED = [Config.STATUS.SCHEDULED, Config.STATUS.RESHIP, Config.STATUS.WAIT_AE];

/* ---------------------------------------------------------------------
 * ตัวช่วย
 * ------------------------------------------------------------------- */

// อีเมลทุกคนของบทบาทนั้น (จากแท็บ Users)
function plEmailsByRole_(roles) {
  var users = plUsers_(), out = [];
  Object.keys(users).forEach(function (em) { if (roles.indexOf(users[em].role) >= 0 && plIsRealEmail_(em)) out.push(em); });   // ผู้ใช้ไม่มีอีเมลไม่รับอีเมล
  return out;
}

// อ่าน Log ครั้งเดียว → ดัชนีการ "สร้างงาน": byKey["แถว|ป้าย"] = { at: เวลาที่สร้างครั้งล่าสุด, email: คนสร้างครั้งล่าสุด }
// bySign[ป้าย] = ["แถว|ป้าย", ...] ไว้หาเมื่อแถวเลื่อน (มีคนแทรก/ลบแถวหลังสร้างงาน)
function plCreationIndex_() {
  var sh = plSheet_(Config.SHEET_LOG);
  var last = sh.getLastRow(), idx = { byKey: {}, bySign: {} };
  if (last < 2) return idx;
  sh.getRange(2, 1, last - 1, 8).getDisplayValues().forEach(function (r) {
    if (r[7].indexOf(PL_ACTIONS.create.label) !== 0 || !r[3]) return;
    var k = r[2] + "|" + r[3];
    var e = idx.byKey[k];
    if (!e) { e = idx.byKey[k] = { at: "", email: "" }; (idx.bySign[r[3]] = idx.bySign[r[3]] || []).push(k); }
    e.at = r[0];                                   // สร้างซ้ำ (งานถูกล้างแล้วสร้างใหม่) → นับจากครั้งล่าสุด
    if (r[1]) e.email = r[1].toLowerCase();
  });
  return idx;
}

// การสร้างงานของ job นี้: ตรง "แถว|ป้าย" → ใช้เลย · ไม่ตรง (แถวเลื่อน) → ใช้รายการของป้ายเดียวกันที่ไม่มีงานปัจจุบันอ้างถึง
// ถ้าเหลือรายการเดียว · ไม่แน่ใจ → null (ผู้เรียกต้องบอกในหมายเหตุ ไม่เดา)
function plCreationOf_(idx, job, jobKeys) {
  var k = job.row + "|" + job.sign;
  if (idx.byKey[k]) return idx.byKey[k];
  var cand = (idx.bySign[job.sign] || []).filter(function (c) { return !jobKeys[c]; });
  return cand.length === 1 ? idx.byKey[cand[0]] : null;
}

// { "แถว|ป้าย": true } ของงานปัจจุบัน
function plJobKeys_(jobs) {
  var o = {};
  jobs.forEach(function (j) { o[j.row + "|" + j.sign] = true; });
  return o;
}

// AE ที่ต้องได้รับเรื่องของงานนี้: คนสร้างงาน · ไม่รู้ว่าใคร → AE ทุกคน
function plAeFor_(idx, job, jobKeys) {
  var c = plCreationOf_(idx, job, jobKeys);
  return c && c.email ? [c.email] : plEmailsByRole_(["AE"]);
}

function plWebAppUrl_() {
  var u = Config.prop("WEBAPP_URL");
  if (u) return u;
  try { return ScriptApp.getService().getUrl() || ""; } catch (e) { return ""; }
}

function plEsc_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function plShortDate_(key) { return key ? formatDate_(parseDate_(key)) : "-"; }

// บรรทัดสรุปงาน 1 งานในอีเมล
function plJobLine_(j, extra) {
  return "<b>" + plEsc_(j.sign) + "</b> · " + plEsc_(j.customer || "-") + " · " + plEsc_(j.airport || j.iata || "") +
    " · ส่ง " + plShortDate_(j.shipDate) + " · ติดตั้ง " + plShortDate_(j.installDate) + " · Ad on " + plShortDate_(j.adOn) +
    (j.team ? " · ทีม " + plEsc_(j.team) : "") + " · สถานะ <i>" + plEsc_(j.status || "-") + "</i>" + (extra ? " · " + plEsc_(extra) : "");
}

// กล่องจดหมาย: box.add(emails, หัวข้อ, บรรทัด) → รวมเป็นฉบับเดียวต่อคน แยกหัวข้อ
function plMailbox_() {
  var by = {};
  return {
    by: by,
    add: function (emails, section, line) {
      (emails || []).forEach(function (em) {
        em = String(em || "").trim().toLowerCase();
        if (!em || em.indexOf("@") < 0) return;
        var box = by[em] || (by[em] = { order: [], sections: {} });
        if (!box.sections[section]) { box.sections[section] = []; box.order.push(section); }
        if (box.sections[section].indexOf(line) < 0) box.sections[section].push(line);
      });
    }
  };
}

function plEffectiveEmail_() {
  try { return plStr_(Session.getEffectiveUser().getEmail()); } catch (e) { return ""; }
}

// ปลายทางแทนตอนทดสอบ → { to, blocked } · blocked มีข้อความ = ห้ามส่งเลย
function plNotifyRedirect_() {
  var to = plStr_(Config.prop("NOTIFY_REDIRECT_TO"));
  if (to) return { to: to, blocked: "" };
  if (!plIsTestMode_()) return { to: "", blocked: "" };
  var me = plEffectiveEmail_();
  if (me) return { to: me, blocked: "" };
  return { to: "", blocked: "โหมดทดสอบแต่หาอีเมลปลายทางทดสอบไม่ได้ (ตั้ง Script Property NOTIFY_REDIRECT_TO) จึงไม่ส่งอีเมลเลย" };
}

// ส่งอีเมลจากกล่องจดหมาย · คืน { sent, sentTo, skipped, blocked, redirectedTo, recipients, errors }
// opts: dryRun · exclude = [อีเมลที่ได้ไปแล้ว ไม่ต้องส่งซ้ำ] · quota = จำนวนฉบับสูงสุด (ใช้ทดสอบกรณีโควต้าหมด)
function plSendMailbox_(box, subject, intro, opts) {
  opts = opts || {};
  var exclude = opts.exclude || [];
  var emails = Object.keys(box.by).filter(function (em) { return exclude.indexOf(em) < 0; });
  var res = { sent: 0, sentTo: [], skipped: [], blocked: "", redirectedTo: "", recipients: emails, errors: [] };
  if (!emails.length || opts.dryRun) return res;
  var rd = plNotifyRedirect_();
  if (rd.blocked) { res.blocked = rd.blocked; return res; }
  var redirect = rd.to;
  res.redirectedTo = redirect;
  var url = plWebAppUrl_();
  var quota = MailApp.getRemainingDailyQuota();
  if (opts.quota != null) quota = Math.min(quota, opts.quota);
  var users = plUsers_();
  emails.forEach(function (em) {
    if (quota <= 0) { res.skipped.push(em); return; }
    var b = box.by[em];
    var name = (users[em] || {}).name || "";
    var html = '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#222">' +
      (redirect ? '<p style="background:#fff3cd;padding:8px;border:1px solid #e0c36c">[TEST] ฉบับนี้ตั้งใจส่งถึง <b>' + plEsc_(em) + "</b> แต่ถูกส่งมาที่คุณแทน (โหมดทดสอบ)</p>" : "") +
      "<p>เรียน " + plEsc_(name || em) + "</p><p>" + plEsc_(intro) + "</p>";
    b.order.forEach(function (sec) {
      html += '<h3 style="margin:16px 0 6px;font-size:15px">' + plEsc_(sec) + " (" + b.sections[sec].length + ")</h3><ul style=\"margin:0;padding-left:20px\">" +
        b.sections[sec].map(function (l) { return "<li style=\"margin:3px 0\">" + l + "</li>"; }).join("") + "</ul>";
    });
    if (url) html += '<p style="margin-top:16px"><a href="' + plEsc_(url) + '">เปิดหน้า Poster Logistics</a></p>';
    html += '<p style="color:#888;font-size:12px">อีเมลอัตโนมัติจากระบบ Poster Logistics · ไม่ต้องตอบกลับ</p></div>';
    try {
      MailApp.sendEmail({ to: redirect || em, subject: (redirect ? "[TEST] " : "") + subject, htmlBody: html, name: "Poster Logistics" });
      res.sent++; res.sentTo.push(em); quota--;
    } catch (e) {
      res.errors.push(em + ": " + (e.message || e));
    }
  });
  return res;
}

// ส่งครบทุกคนหรือยัง
function plMailComplete_(m) { return !m.blocked && !m.skipped.length && !m.errors.length; }

function plReadJsonProp_(key) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// งานทั้งหมดตั้งแต่เดือนที่เริ่มใช้ระบบ (อ่านชีตครั้งเดียว)
function plActiveJobs_(ctx) {
  var last = ctx.sheet.getLastRow();
  if (last < Config.DATA_START_ROW) return [];
  var vals = ctx.sheet.getRange(Config.DATA_START_ROW, 1, last - Config.DATA_START_ROW + 1, ctx.width).getValues();
  var out = [];
  vals.forEach(function (v, i) {
    var j = plRowToJob_(ctx, v, i + Config.DATA_START_ROW);
    if (j.sign && j.monthKey && j.monthKey >= Config.GO_LIVE_MONTH && j.status) out.push(j);
  });
  return out;
}

/* ---------------------------------------------------------------------
 * สรุปประจำวัน 08:00
 * ------------------------------------------------------------------- */

// เรียกจาก trigger
// (ไม่คืนผลลัพธ์ — ฟังก์ชันนี้ถูกเรียกจากหน้าเว็บได้ จึงไม่ส่งรายชื่อผู้รับ/แผนอีเมลออกไป ดูผลได้ใน Execution log)
function plDailyDigest(e) {
  plRequireTriggerOrAdmin_(e);
  var r = plDailyDigest_({});
  console.log(JSON.stringify(r));
}

var PL_DIGEST_MAX_TRIES = 4;          // รอบแรก 08:00 + ลองส่งต่อให้คนที่ยังไม่ได้อีก 3 รอบ (ผ่านรอบรายชั่วโมง)
var PL_SEC_ONAIR_NEW = "ขึ้น On air แล้ว — กรุณาส่ง Proof ให้ลูกค้า";
var PL_SEC_ONAIR_WAIT = "On air แล้ว ยังไม่ได้กด \"ส่ง Proof แล้ว\"";

function plDigestKey_() { return "PL_DIGEST_STATE_" + plSpreadsheetId_(); }

// opts: { dryRun: true = ไม่เขียนชีต ไม่ส่งเมล, today: "yyyy-MM-dd" (ไว้ทดสอบ), force: true = ส่งซ้ำแม้วันนี้ส่งครบแล้ว, quota }
function plDailyDigest_(opts) {
  opts = opts || {};
  var today = opts.today || plDateKey_(new Date());
  var tomorrow = plDateKey_(plAddDays_(today, 1));

  // วันละครั้ง: จำว่าวันนี้ส่งให้ใครแล้ว · ส่งครบแล้วไม่ส่งซ้ำ · ส่งไม่ครบ → รอบถัดไปส่งเฉพาะคนที่ยังไม่ได้
  var st = null;
  if (!opts.dryRun) {
    st = plReadJsonProp_(plDigestKey_());
    if (!st || st.day !== today || opts.force) st = { day: today, sent: [], complete: false, tries: 0 };
    else if (st.complete) return { ok: true, today: today, skipped: "วันนี้ส่งสรุปไปแล้ว (ส่งซ้ำใช้ force)", mail: { sent: 0, sentTo: [] } };
  }

  var ctx = plJobsCtx_();
  var jobs = plActiveJobs_(ctx);
  var jobKeys = plJobKeys_(jobs);
  var cidx = plCreationIndex_();
  var box = plMailbox_();
  var ops = plEmailsByRole_(["Ops"]), prod = plEmailsByRole_(["Production"]), inst = plEmailsByRole_(["Installer"]);
  var ma = plEmailsByRole_(["MA"]), admins = plEmailsByRole_(["Admin"]);
  var notes = [], onAir = [], onAirFail = [];

  // 1) ถึงวัน Ad on + ติดตั้งแล้ว → On air (ระบบเปลี่ยนเอง ผ่าน plMutate_ = lock + เทียบ version + Log) แล้วแจ้ง AE ส่ง Proof
  //    งานที่ On air อยู่แล้วแต่ยังไม่ปิด (ยังไม่กด "ส่ง Proof แล้ว") แจ้ง AE ซ้ำทุกวันจนกว่าจะปิด — ดูจากสถานะในชีต
  //    จึงไม่ตกหล่นแม้วันที่สลับ On air อีเมลจะส่งไม่ออก
  jobs.forEach(function (j) {
    if (j.status === PL_S.ON_AIR) { box.add(plAeFor_(cidx, j, jobKeys), PL_SEC_ONAIR_WAIT, plJobLine_(j)); return; }
    if ((j.status !== PL_S.INSTALLED && j.status !== PL_S.INSTALLED_MANUAL) || !j.adOn || j.adOn > today) return;
    if (opts.dryRun) { onAir.push(j.sign); box.add(plAeFor_(cidx, j, jobKeys), PL_SEC_ONAIR_NEW, plJobLine_(j)); return; }
    try {
      var r = plMutate_(PL_SYSTEM_USER, j.rowKey, j.ver, {
        action: "On air (ระบบเปลี่ยนเมื่อถึงวัน Ad on)", roles: ["System"], from: [PL_S.INSTALLED, PL_S.INSTALLED_MANUAL],
        apply: function () { return { changes: { status: PL_S.ON_AIR } }; }
      });
      onAir.push(j.sign);
      box.add(plAeFor_(cidx, j, jobKeys), PL_SEC_ONAIR_NEW, plJobLine_(r.job));
    } catch (e) {
      onAirFail.push(j.sign + " (" + (e.code || "ERROR") + ")");
    }
  });

  jobs.forEach(function (j) {
    // 2) D-1 วันจัดส่ง → Production + Ops
    if (j.shipDate === tomorrow && PL_NOT_SHIPPED.indexOf(j.status) >= 0) {
      box.add(prod.concat(ops), "พรุ่งนี้ต้องส่ง Poster", plJobLine_(j, "ส่งไป " + (j.shipTo || "-")));
    }
    // 3) D-1 วันติดตั้ง → MA + Installer (จุดรับของไม่มีอีเมลในระบบ จึงยังไม่แจ้ง)
    if (j.installDate === tomorrow && PL_INSTALLED_SET.indexOf(j.status) < 0) {
      box.add(ma.concat(inst), "พรุ่งนี้ต้องติดตั้ง", plJobLine_(j, "รับของที่ " + (j.shipTo || "-") + (j.receiver ? " (" + j.receiver + ")" : "")));
    }
    // 4) เลยกำหนดแล้วยังไม่กด → เรื่องส่ง: Ops · เรื่องรับของ/ติดตั้ง: Ops + MA
    if (j.shipDate && j.shipDate < today && PL_NOT_SHIPPED.indexOf(j.status) >= 0) {
      box.add(ops, "เลยวันส่งแล้วยังไม่กด \"ส่งแล้ว\"", plJobLine_(j));
    } else if (j.status === PL_S.SHIPPED && j.installDate && j.installDate < today) {
      box.add(ops.concat(ma), "เลยวันติดตั้งแล้วยังไม่กด \"ได้รับของแล้ว\"", plJobLine_(j));
    } else if (j.status === PL_S.RECEIVED && j.installDate && j.installDate < today) {
      box.add(ops.concat(ma), "เลยวันติดตั้งแล้วยังไม่กด \"ติดตั้งแล้ว\"", plJobLine_(j));
    }
    // 4.1) ค้างอยู่ที่ Admin / MA → แจ้งทุกวันจนกว่าจะทำ
    if (j.status === PL_S.WAIT_SHIP) {
      box.add(admins, "รอกำหนดวันส่ง (หลังคุยโรงพิมพ์)", plJobLine_(j));
    } else if (j.status === PL_S.WAIT_MA) {
      box.add(ma, "รอ MA แจ้งแผนติดตั้ง (Admin กำหนดวันส่งแล้ว)", plJobLine_(j, "ส่งวันที่ " + plShortDate_(j.shipDate)));
    }
  });

  // 5) ยังไม่กำหนดวันส่งภายใน SLA → หัวหน้า (ไม่ได้ตั้ง OPS_HEAD_EMAIL → ส่ง Admin แทน)
  var head = Config.prop("OPS_HEAD_EMAIL");
  var slaTo = head ? head.split(/[,\s]+/) : admins;
  if (!head) notes.push("ยังไม่ได้ตั้ง OPS_HEAD_EMAIL จึงส่งเรื่องเกิน SLA ให้ Admin แทน");
  var noCreated = [];
  jobs.forEach(function (j) {
    if (j.status !== PL_S.WAIT_SHIP) return;
    var c = plCreationOf_(cidx, j, jobKeys);
    if (!c || !c.at) { noCreated.push(j.sign); return; }
    var due = plDateKey_(plAddWorkdays_(c.at, Config.SLA_WORKDAYS));
    if (due < today) box.add(slaTo, "ยังไม่กำหนดวันส่งเกิน " + Config.SLA_WORKDAYS + " วันทำการ", plJobLine_(j, "สร้างงานเมื่อ " + c.at.slice(0, 16) + " ครบกำหนด " + plShortDate_(due)));
  });
  if (noCreated.length) notes.push("หาเวลาสร้างงานใน Log ไม่พบ จึงคิด SLA ไม่ได้: " + noCreated.join(", "));

  var sendOpts = { dryRun: opts.dryRun, quota: opts.quota, exclude: st ? st.sent : [] };
  var mail = plSendMailbox_(box, "สรุปงาน Poster ประจำวัน " + plShortDate_(today), "สรุปงาน Poster ที่ต้องดูวันนี้", sendOpts);
  var result = { ok: true, today: today, dryRun: !!opts.dryRun, onAir: onAir, onAirFail: onAirFail, plan: plMailboxSummary_(box), mail: mail, notes: notes };
  if (opts.dryRun) { result.detail = box.by; return result; }

  st.sent = st.sent.concat(mail.sentTo);
  st.tries++;
  st.complete = plMailComplete_(mail);
  if (!st.complete && st.tries >= PL_DIGEST_MAX_TRIES) {
    st.complete = true;
    notes.push("ลองส่งครบ " + PL_DIGEST_MAX_TRIES + " รอบแล้วยังส่งไม่ครบ เลิกลองของวันนี้");
  } else if (!st.complete) {
    notes.push("ส่งไม่ครบ รอบรายชั่วโมงจะลองส่งให้คนที่ยังไม่ได้ (รอบที่ " + st.tries + "/" + PL_DIGEST_MAX_TRIES + ")");
  }
  PropertiesService.getScriptProperties().setProperty(plDigestKey_(), JSON.stringify(st));
  result.complete = st.complete;
  plLogNotify_("แจ้งเตือนประจำวัน 08:00", result);
  return result;
}

// รอบรายชั่วโมงเรียก: หลัง 09:00 ถ้าสรุปของวันนี้ยังไม่ได้ส่ง/ส่งไม่ครบ → ลองอีกครั้ง
function plDigestCatchUp_() {
  var now = new Date();
  if (parseInt(Utilities.formatDate(now, Config.TZ, "H"), 10) < 9) return null;
  var st = plReadJsonProp_(plDigestKey_());
  if (st && st.day === plDateKey_(now) && st.complete) return null;
  return plDailyDigest_({});
}

// สรุปกล่องจดหมายแบบอ่านง่าย (ใช้ตรวจ/ทดสอบ): { email: { หัวข้อ: จำนวน } }
function plMailboxSummary_(box) {
  var out = {};
  Object.keys(box.by).forEach(function (em) {
    out[em] = {};
    box.by[em].order.forEach(function (s) { out[em][s] = box.by[em].sections[s].length; });
  });
  return out;
}

// บันทึกผลการแจ้งเตือนลง Log 1 แถว
function plLogNotify_(what, r) {
  var m = r.mail || {};
  var text = "ส่ง " + (m.sent || 0) + " ฉบับ" + (m.redirectedTo ? " (ส่งแทนไปที่ " + m.redirectedTo + ")" : "") +
    " · ผู้รับ " + (m.recipients || []).join(", ") +
    (m.blocked ? " · ไม่ได้ส่ง: " + m.blocked : "") +
    (m.skipped && m.skipped.length ? " · โควต้าหมด ไม่ได้ส่ง: " + m.skipped.join(", ") : "") +
    (m.errors && m.errors.length ? " · ส่งไม่สำเร็จ: " + m.errors.join("; ") : "") +
    (r.onAir && r.onAir.length ? " · On air: " + r.onAir.join(", ") : "") +
    (r.onAirFail && r.onAirFail.length ? " · เปลี่ยน On air ไม่ได้: " + r.onAirFail.join(", ") : "") +
    (r.notes && r.notes.length ? " · " + r.notes.join(" · ") : "");
  withLock_(function () { appendLog_([{ email: PL_SYSTEM_USER.email, action: what, newVal: text }]); });
}

/* ---------------------------------------------------------------------
 * แจ้งทันที (รอบละชั่วโมง): อ่าน Log ที่เพิ่มหลังรอบก่อน
 * ------------------------------------------------------------------- */

function plHourlyNotify(e) {
  plRequireTriggerOrAdmin_(e);
  var r = plHourlyNotify_({});
  console.log(JSON.stringify(r));
  try {
    var d = plDigestCatchUp_();
    if (d) console.log("ส่งสรุปประจำวันย้อนหลัง: " + JSON.stringify(d));
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
  }
}

var PL_HOURLY_MAX_TRIES = 6;          // ส่งไม่ครบติดกันเกินนี้ → เลื่อนตำแหน่ง Log ต่อไป (ลง Log ว่าเลิกลอง)

function plHourlyKey_() { return "PL_NOTIFY_LAST_LOG_ROW_" + plSpreadsheetId_(); }

// ตำแหน่ง Log ที่ประมวลผลแล้ว: { row, ts (เวลาในแถวนั้น ใช้ตรวจว่าแถวไม่เลื่อน), got: { email: แถวสุดท้ายที่ได้รับแล้ว }, tries }
function plHourlyState_(key) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;
  if (raw.charAt(0) === "{") { try { return JSON.parse(raw); } catch (e) { return null; } }
  var n = parseInt(raw, 10);          // รูปแบบเก่า: เลขแถวอย่างเดียว
  return n ? { row: n, ts: "", got: {}, tries: 0 } : null;
}

// แถวสุดท้ายที่ประมวลผลแล้วจริง ๆ ตอนนี้: ถ้าเวลาในแถวที่จำไว้ไม่ตรง (มีคนลบ/แทรกแถวใน Log) → หาแถวสุดท้ายที่เวลา ≤ เวลาที่จำไว้
function plHourlyDone_(sh, st, last) {
  if (!st.ts || st.row < 2) return Math.min(st.row, last);
  if (st.row <= last && sh.getRange(st.row, 1).getDisplayValue() === st.ts) return st.row;
  if (last < 2) return 1;
  var ts = sh.getRange(2, 1, last - 1, 1).getDisplayValues(), done = 1;
  for (var i = 0; i < ts.length; i++) if (ts[i][0] && ts[i][0] <= st.ts) done = i + 2;
  return done;
}

// opts: { dryRun, fromRow (ทดสอบ: เริ่มอ่าน Log ตั้งแต่แถวนี้ ไม่แตะตำแหน่งที่จำไว้), quota }
function plHourlyNotify_(opts) {
  opts = opts || {};
  var sh = plSheet_(Config.SHEET_LOG);
  var key = plHourlyKey_();
  var props = PropertiesService.getScriptProperties();
  var last = sh.getLastRow();
  var keep = !opts.dryRun && !opts.fromRow;        // รอบจริง: จำตำแหน่ง
  var st = opts.fromRow ? { row: opts.fromRow - 1, ts: "", got: {}, tries: 0 } : plHourlyState_(key);
  function save(row, got, tries) {
    props.setProperty(key, JSON.stringify({ row: row, ts: row >= 2 ? sh.getRange(row, 1).getDisplayValue() : "", got: got || {}, tries: tries || 0 }));
  }
  if (!st) {                         // รอบแรก: เริ่มนับจากตอนนี้ ไม่ย้อนส่งเรื่องเก่า
    if (keep) save(last);
    return { ok: true, first: true, lastRow: last };
  }
  var done = plHourlyDone_(sh, st, last);
  var got = st.got || {};
  var rows = last > done ? sh.getRange(done + 1, 1, last - done, 8).getDisplayValues() : [];

  // รวมแถว Log เป็นเหตุการณ์ (เวลา + แถว + ป้าย + คนทำ เดียวกัน = การบันทึกครั้งเดียว)
  var events = [], idx = {};
  rows.forEach(function (r, i) {
    if (!r[2] || !r[3] || r[1] === PL_SYSTEM_USER.email) return;
    var k = r[0] + "|" + r[2] + "|" + r[3] + "|" + r[1];
    var ev = idx[k];
    if (!ev) { ev = idx[k] = { at: r[0], row: r[2], sign: r[3], by: r[1], action: r[7], ch: {}, logRow: 0 }; events.push(ev); }
    ev.logRow = done + 1 + i;
    if (r[4]) ev.ch[r[4]] = { o: r[5], n: r[6] };
  });

  var box = plMailbox_();
  if (events.length) {
    var ctx = plJobsCtx_();
    var jobs = {}, bySign = {};
    var active = plActiveJobs_(ctx);
    active.forEach(function (j) { jobs[j.row + "|" + j.sign] = j; (bySign[j.sign] = bySign[j.sign] || []).push(j); });
    var jobKeys = plJobKeys_(active);
    var cidx = plCreationIndex_();
    var ma = plEmailsByRole_(["MA"]), admins = plEmailsByRole_(["Admin"]), prod = plEmailsByRole_(["Production"]);
    var stCol = PL_F.status;
    events.forEach(function (ev) {
      // งานปัจจุบันของเหตุการณ์นี้: แถวตรง → ใช้เลย · แถวเลื่อน → ป้ายเดียวกันที่มีงานเดียว · ไม่พบ → ไม่รู้สถานะปัจจุบัน
      var j = jobs[ev.row + "|" + ev.sign] || ((bySign[ev.sign] || []).length === 1 ? bySign[ev.sign][0] : null);
      var shown = j || { row: ev.row, sign: ev.sign, status: "(ไม่พบแถวแล้ว)" };
      var sc = ev.ch[stCol];
      var who = ev.by + " เมื่อ " + ev.at.slice(0, 16);
      var note = ev.action.indexOf(" · ") > 0 ? ev.action.slice(ev.action.indexOf(" · ") + 3) : "";
      // คนที่ได้รับเรื่องของเหตุการณ์นี้ไปแล้วในรอบก่อน (รอบที่ส่งไม่ครบ) ไม่ต้องได้ซ้ำ
      function add(emails, section, line) {
        box.add((emails || []).filter(function (em) { return !(got[em] >= ev.logRow); }), section, line);
      }
      var isPlan = ev.action.indexOf(PL_ACTIONS.plan.label) === 0, isShip = ev.action.indexOf(PL_ACTIONS.shipDate.label) === 0;
      var open = j && (j.status === PL_S.WAIT_SHIP || j.status === PL_S.WAIT_MA);
      // "งานใหม่" / "รอ MA" / "แถวแดง" แจ้งเฉพาะเมื่อตอนนี้งานยังค้างอยู่ที่สถานะนั้น (มีคนจัดการไปแล้วในชั่วโมงเดียวกัน ไม่ต้องแจ้ง)
      if (sc && sc.n === PL_S.WAIT_SHIP && !sc.o) {
        if (j && j.status === PL_S.WAIT_SHIP) add(admins, "งานใหม่เข้าคิว รอกำหนดวันส่ง (หลังคุยโรงพิมพ์)", plJobLine_(j, "AE " + who));
      } else if (sc && sc.o === PL_S.WAIT_SHIP && sc.n === PL_S.WAIT_MA) {
        if (j && j.status === PL_S.WAIT_MA) add(ma, "Admin กำหนดวันส่งแล้ว รอ MA แจ้งแผนติดตั้ง", plJobLine_(j, "ส่งวันที่ " + plShortDate_(j.shipDate) + " · โดย " + who));
      } else if (sc && sc.n === PL_S.WAIT_AE) {
        if (j && j.status === PL_S.WAIT_AE) {
          add(plAeFor_(cidx, j, jobKeys), "แถวแดง: ติดตั้งหลัง Ad on รอ AE กดรับทราบ", plJobLine_(j, "เหตุผล: " + (note || j.reason || "-") + " · โดย " + who));
        }
      } else if (sc && sc.o === PL_S.WAIT_MA && sc.n === PL_S.SCHEDULED) {
        // กำหนดการครบครั้งแรก → AE คนสร้าง + MA + Production (คนส่งของ)
        add(plAeFor_(cidx, shown, jobKeys).concat(ma, prod), "กำหนดการครบแล้ว (มีวันส่งและแผนติดตั้ง)", plJobLine_(shown, "โดย " + who));
      } else if ((isPlan || isShip) && !open) {
        // แก้แผน/วันส่งหลังกำหนดการครบแล้ว → AE คนสร้าง + อีกฝั่ง (MA แก้ → Admin รู้ · Admin แก้ → MA รู้) + Production
        add(plAeFor_(cidx, shown, jobKeys).concat(isPlan ? admins : ma, prod), "แก้กำหนดการหลังกำหนดการครบแล้ว",
          plJobLine_(shown, (isPlan ? "แก้แผนติดตั้ง" : "แก้วันส่ง") + (note ? " · เหตุผล: " + note : "") + " · โดย " + who));
      }
    });
  }
  var mail = plSendMailbox_(box, "อัปเดตงาน Poster", "มีความเคลื่อนไหวของงาน Poster ที่เกี่ยวกับคุณ", opts);
  var result = { ok: true, fromRow: done + 1, toRow: last, events: events.length, plan: plMailboxSummary_(box), mail: mail, dryRun: !!opts.dryRun, notes: [] };
  if (keep) {
    // เลื่อนตำแหน่งเมื่อส่งครบทุกคนเท่านั้น · ส่งไม่ครบ → จำว่าใครได้ถึงแถวไหนแล้ว รอบหน้าส่งเฉพาะที่ยังไม่ได้
    result.advanced = plMailComplete_(mail);
    if (result.advanced) {
      save(last);
    } else {
      mail.sentTo.forEach(function (em) { got[em] = last; });
      var tries = (st.tries || 0) + 1;
      if (tries >= PL_HOURLY_MAX_TRIES) {
        save(last);
        result.notes.push("ส่งไม่ครบติดกัน " + tries + " รอบ เลิกลองเรื่องช่วงนี้ (แถว Log " + (done + 1) + "–" + last + ")");
      } else {
        save(done, got, tries);
        result.notes.push("ส่งไม่ครบ จะลองใหม่รอบหน้า (รอบที่ " + tries + "/" + PL_HOURLY_MAX_TRIES + ")");
      }
    }
  }
  if (!opts.dryRun && mail.recipients.length) plLogNotify_("แจ้งเตือนรายชั่วโมง", result);
  return result;
}

/* ---------------------------------------------------------------------
 * ตั้ง trigger — รันมือจาก editor (ครั้งแรกจะขอสิทธิ์)
 * ระวัง: trigger ใช้ชีตตามโหมดตอนรัน (โหมดทดสอบ = สำเนา) · ตั้งบนชีตจริงเมื่อพร้อมใช้งานเท่านั้น
 * ------------------------------------------------------------------- */

var PL_TRIGGER_FNS = ["plDailyDigest", "plHourlyNotify", "plOnEditB"];

// ลบ trigger ของระบบนี้ · match (ไม่บังคับ) = ลบเฉพาะตัวที่ฟังก์ชันนี้คืน true
function plRemoveTriggers_(match) {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (PL_TRIGGER_FNS.indexOf(t.getHandlerFunction()) < 0) return;
    if (match && !match(t)) return;
    ScriptApp.deleteTrigger(t); n++;
  });
  console.log("ลบ trigger ของ Poster Logistics " + n + " ตัว");
  return n;
}

// ลบ trigger ทั้งหมดของระบบนี้ (ทั้งของชีตจริงและของสำเนา)
function plRemoveTriggers() { plRequireAdminCaller_(); return plRemoveTriggers_(null); }

// only: "edit" = ตั้งเฉพาะ onEdit ของชีตที่ใช้อยู่ตอนนี้ (ใช้ตอนทดสอบบนสำเนา) — ไม่แตะ trigger ตัวอื่น
function plInstallTriggers_(only) {
  var ssId = plSpreadsheetId_();
  if (only === "edit") {
    plRemoveTriggers_(function (t) { return t.getHandlerFunction() === "plOnEditB" && t.getTriggerSourceId() === ssId; });
  } else {
    plRemoveTriggers_(null);
  }
  ScriptApp.newTrigger("plOnEditB").forSpreadsheet(ssId).onEdit().create();
  if (only !== "edit") {
    ScriptApp.newTrigger("plDailyDigest").timeBased().atHour(8).everyDays(1).inTimezone(Config.TZ).create();
    ScriptApp.newTrigger("plHourlyNotify").timeBased().everyHours(1).create();
  }
  var list = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + ":" + t.getEventType(); });
  console.log("ตั้ง trigger แล้ว (ชีต " + ssId + (plIsTestMode_() ? " = สำเนาทดสอบ" : " = ชีตจริง") + "): " + list.join(", "));
  return list;
}

// ตั้ง trigger ทั้งชุดบนชีตจริง — ไม่ยอมทำตอนอยู่ในโหมดทดสอบ
// (กัน trigger ตามเวลาไปผูกกับสำเนา และกันลบ trigger ของชีตจริงโดยไม่ตั้งใจ)
function plInstallTriggers() {
  plRequireAdminCaller_();
  if (plIsTestMode_()) {
    throw new Error("ตอนนี้อยู่ในโหมดทดสอบ (ใช้สำเนาชีต) — รัน plUiTestOff ก่อน แล้วค่อยรัน plInstallTriggers · ถ้าจะลองติ๊กบนสำเนาใช้ plTestInstallEditTrigger");
  }
  return plInstallTriggers_("");
}

// แสดง trigger ของระบบนี้ว่าผูกกับชีตไหน (อ่านอย่างเดียว ไม่แก้/ไม่ลบอะไร) · รันมือจาก editor
function plListTriggers() {
  plRequireAdminCaller_();
  var lines = [];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (PL_TRIGGER_FNS.indexOf(fn) < 0) return;
    var src = "", sid = "";
    try { src = String(t.getTriggerSource()); sid = String(t.getTriggerSourceId() || ""); } catch (e) { }
    var which = !sid ? "(ตามเวลา ไม่ผูกชีต)" : sid === PL_REAL_SPREADSHEET_ID_ ? "= ชีตจริง" : sid === PL_TEST_SPREADSHEET_DEFAULT ? "= สำเนาทดสอบ" : "= ชีตอื่น";
    lines.push(fn + " · " + t.getEventType() + " · " + src + (sid ? " · " + sid : "") + " " + which);
  });
  if (!lines.length) lines.push("ไม่พบ trigger ของ Poster Logistics");
  Logger.log(lines.join("\n"));
  return lines;
}
