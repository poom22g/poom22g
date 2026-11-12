/* =====================================================================
 * Poster Logistics — Auth: เข้าสู่ระบบตามบทบาท + ตัวกันฟังก์ชันดูแลระบบ
 *
 * ใครคือผู้ใช้ (plCurrentUser_ ใน Logistics.gs):
 *   1) บัญชี Google ที่ระบบอ่านอีเมลได้ และอยู่ในแท็บ Users → ใช้ได้เลย ไม่ต้องกรอกอะไร
 *   2) นอกนั้น → เข้าสู่ระบบด้วย "ชื่อผู้ใช้/อีเมล + รหัสผ่าน" (Admin สร้างให้ในหน้า จัดการผู้ใช้)
 *      หรือ "อีเมล + รหัส 6 หลัก" ที่ส่งไปทางอีเมล (ต้องเป็นอีเมลในแท็บ Users)
 *      ผ่านแล้วได้ token อายุ PL_AUTH.SESSION_DAYS วัน เก็บในเครื่องผู้ใช้ และส่งมากับทุกคำสั่ง
 *      รหัสผ่านเก็บเป็นค่าแฮช (มี salt) ใน Script Properties เท่านั้น — ไม่เก็บในชีต (ชีตแชร์ลิงก์อยู่)
 *   บทบาทอ่านจากแท็บ Users ทุกครั้ง → ลบคนออกจาก Users = หมดสิทธิ์ทันที แม้ token ยังไม่หมดอายุ
 *
 * หน้าเว็บเรียกทุกคำสั่งผ่าน plCall(token, ชื่อคำสั่ง, [ค่า]) — ไม่รู้ว่าเป็นใคร = LOGIN_REQUIRED
 *
 * Script Properties ที่ไฟล์นี้ใช้: PL_AUTH_SECRET (ระบบสร้างเองครั้งแรก · ห้ามเปิดเผย)
 * ไม่ใช้ scope ใหม่ (ส่งอีเมลด้วย MailApp ตัวเดียวกับ Notify.gs)
 * ===================================================================== */

var PL_AUTH = {
  OTP_TTL_SEC: 600,        // รหัสใช้ได้ 10 นาที
  OTP_MAX_TRIES: 5,        // กรอกผิดได้ 5 ครั้งต่อรหัส
  OTP_RESEND_SEC: 60,      // ขอรหัสใหม่ได้ทุก 1 นาที
  OTP_PER_HOUR: 5,         // ขอรหัสได้ 5 ครั้งต่อชั่วโมงต่ออีเมล
  SESSION_DAYS: 30
};

/* ---------------------------------------------------------------------
 * ตัวช่วย
 * ------------------------------------------------------------------- */

function plAuthNormEmail_(s) {
  var e = String(s == null ? "" : s).trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

function plAuthHex_(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 255;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

function plAuthSha_(s) {
  return plAuthHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

// key ของ cache ต่ออีเมล (ไม่เอาอีเมลดิบไปเป็น key)
function plAuthKey_(prefix, email) { return prefix + plAuthSha_(email).slice(0, 32); }

// ความลับสำหรับเซ็น token — สร้างครั้งเดียว เก็บใน Script Properties
function plAuthSecret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty("PL_AUTH_SECRET");
  if (s) return s;
  var lock = null;
  try { lock = LockService.getUserLock(); lock.waitLock(10000); } catch (e) { lock = null; }   // คนละตัวกับ lock ของ withLock_
  try {
    s = p.getProperty("PL_AUTH_SECRET");
    if (!s) {
      s = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
      p.setProperty("PL_AUTH_SECRET", s);
    }
  } finally {
    if (lock) try { lock.releaseLock(); } catch (e2) { }
  }
  return s;
}

function plAuthSign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, plAuthSecret_(), Utilities.Charset.UTF_8));
}

// เทียบข้อความแบบใช้เวลาเท่ากันทุกตำแหน่ง
function plAuthSame_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// token = v1.<อีเมล base64>.<หมดอายุ ms>.<ลายเซ็น>
function plAuthIssueToken_(email) {
  var exp = Date.now() + PL_AUTH.SESSION_DAYS * 864e5;
  var e64 = Utilities.base64EncodeWebSafe(email, Utilities.Charset.UTF_8);
  return { token: "v1." + e64 + "." + exp + "." + plAuthSign_("v1|" + email + "|" + exp), exp: exp };
}

// คืนอีเมลถ้า token ถูกต้องและยังไม่หมดอายุ · ไม่งั้นคืน ""
function plAuthEmailFromToken_(tok) {
  try {
    if (typeof tok !== "string" || tok.length > 600) return "";
    var p = tok.split(".");
    if (p.length !== 4 || p[0] !== "v1" || !/^\d{10,16}$/.test(p[2])) return "";
    var exp = Number(p[2]);
    if (!(exp > Date.now())) return "";
    var email = plAuthNormEmail_(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[1])).getDataAsString("UTF-8"));
    if (!email) return "";
    if (!plAuthSame_(p[3], plAuthSign_("v1|" + email + "|" + exp))) return "";
    // ถูกยกเลิกภายหลัง (เปลี่ยน/รีเซ็ตรหัสผ่าน) → token ที่ออกก่อนเวลานั้นใช้ไม่ได้
    var iat = exp - PL_AUTH.SESSION_DAYS * 864e5;
    var min = Number(PropertiesService.getScriptProperties().getProperty(plPwMinKey_(email)) || 0);
    return iat >= min ? email : "";
  } catch (e) {
    return "";
  }
}

// รหัส 6 หลักจากค่าสุ่มของ UUID (ไม่ใช้ Math.random)
function plAuthNewCode_() {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + "|" + Utilities.getUuid(), Utilities.Charset.UTF_8);
  var n = 0;
  for (var i = 0; i < 6; i++) n = (n * 256 + (b[i] & 255)) % 1000000;
  return ("000000" + n).slice(-6);
}

/* ---------------------------------------------------------------------
 * เข้าสู่ระบบ: ขอรหัส → ยืนยันรหัส
 * ------------------------------------------------------------------- */

var PL_AUTH_SENT_MSG = "ถ้าอีเมลนี้อยู่ในรายชื่อผู้ใช้ ระบบส่งรหัส 6 หลักไปให้แล้ว (ใช้ได้ 10 นาที) · ไม่ได้รับภายใน 2 นาที ให้ดูโฟลเดอร์สแปม หรือแจ้ง Admin";

// หน้าเว็บเรียก: ส่งรหัสไปที่อีเมล · ตอบข้อความเดียวกันไม่ว่าอีเมลจะอยู่ใน Users หรือไม่ (ไม่บอกใบ้รายชื่อ)
function plAuthRequestCode(email) {
  return plApi_(function () {
    var em = plAuthNormEmail_(email);
    if (!em) throw plErr_("INVALID", "รูปแบบอีเมลไม่ถูกต้อง");
    var cache = CacheService.getScriptCache();
    if (cache.get(plAuthKey_("pl_otp_rl_", em))) throw plErr_("TOO_MANY", "เพิ่งขอรหัสไป รอ 1 นาทีแล้วค่อยขอใหม่");
    var hrKey = plAuthKey_("pl_otp_hr_", em);
    var n = Number(cache.get(hrKey) || 0);
    if (n >= PL_AUTH.OTP_PER_HOUR) throw plErr_("TOO_MANY", "ขอรหัสบ่อยเกินไป ลองใหม่ในอีก 1 ชั่วโมง");
    cache.put(plAuthKey_("pl_otp_rl_", em), "1", PL_AUTH.OTP_RESEND_SEC);
    cache.put(hrKey, String(n + 1), 3600);

    var u = plUsers_()[em];
    if (!u || !plIsRealEmail_(em)) return { ok: true, message: PL_AUTH_SENT_MSG };   // ผู้ใช้แบบไม่มีอีเมลไม่มีที่ให้ส่ง

    var rd = plNotifyRedirect_();            // โหมดทดสอบ: ส่งแทนไปที่เจ้าของสคริปต์ (กติกาเดียวกับ Notify.gs)
    if (rd.blocked) throw plErr_("ERROR", "โหมดทดสอบ: ระบบไม่รู้อีเมลปลายทางสำหรับส่งรหัส กรุณาแจ้ง Admin");
    if (MailApp.getRemainingDailyQuota() < 1) throw plErr_("ERROR", "โควต้าอีเมลของระบบวันนี้หมดแล้ว กรุณาแจ้ง Admin");

    var code = plAuthNewCode_();
    cache.put(plAuthKey_("pl_otp_", em), JSON.stringify({ h: plAuthSha_(em + "|" + code), tries: 0, exp: Date.now() + PL_AUTH.OTP_TTL_SEC * 1000 }), PL_AUTH.OTP_TTL_SEC);
    var html = "<div style=\"font-family:sans-serif;font-size:15px;color:#10294a\">" +
      (rd.to ? "<p style=\"color:#7a4a00\">[TEST] ฉบับนี้ตั้งใจส่งถึง " + plAuthEsc_(em) + " แต่ถูกส่งมาที่คุณแทน (โหมดทดสอบ)</p>" : "") +
      "<p>รหัสเข้าสู่ระบบ Poster Logistics ของคุณ" + (u.name ? " (" + plAuthEsc_(u.name) + ")" : "") + " คือ</p>" +
      "<p style=\"font-size:30px;font-weight:700;letter-spacing:6px;margin:12px 0\">" + code + "</p>" +
      "<p>รหัสใช้ได้ 10 นาที และใช้ได้ครั้งเดียว · ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร และอย่าส่งรหัสนี้ให้ใคร</p></div>";
    MailApp.sendEmail({ to: rd.to || em, subject: (rd.to ? "[TEST] " : "") + "รหัสเข้าสู่ระบบ Poster Logistics", htmlBody: html, name: "Poster Logistics" });
    return { ok: true, message: PL_AUTH_SENT_MSG };
  });
}

function plAuthEsc_(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
}

// หน้าเว็บเรียก: ตรวจรหัส → คืน token + ข้อมูลผู้ใช้
function plAuthVerifyCode(email, code) {
  return plApi_(function () {
    var bad = "รหัสไม่ถูกต้องหรือหมดอายุแล้ว";
    var em = plAuthNormEmail_(email);
    var c = String(code == null ? "" : code).replace(/\D/g, "");
    if (!em || c.length !== 6) throw plErr_("INVALID", bad);
    var cache = CacheService.getScriptCache();
    var key = plAuthKey_("pl_otp_", em);
    var raw = cache.get(key);
    if (!raw) throw plErr_("INVALID", bad);
    var st = JSON.parse(raw);
    var left = Math.floor((st.exp - Date.now()) / 1000);
    if (left <= 0) { cache.remove(key); throw plErr_("INVALID", bad); }
    if (!plAuthSame_(st.h, plAuthSha_(em + "|" + c))) {
      st.tries = (st.tries || 0) + 1;
      if (st.tries >= PL_AUTH.OTP_MAX_TRIES) {
        cache.remove(key);
        throw plErr_("INVALID", "กรอกรหัสผิดครบ " + PL_AUTH.OTP_MAX_TRIES + " ครั้ง รหัสนี้ใช้ไม่ได้แล้ว กรุณาขอรหัสใหม่");
      }
      cache.put(key, JSON.stringify(st), left);
      throw plErr_("INVALID", "รหัสไม่ถูกต้อง (เหลืออีก " + (PL_AUTH.OTP_MAX_TRIES - st.tries) + " ครั้ง)");
    }
    cache.remove(key);                       // ใช้ได้ครั้งเดียว
    var u = plUsers_()[em];
    if (!u) throw plErr_("FORBIDDEN", "อีเมลนี้ไม่อยู่ในรายชื่อผู้ใช้แล้ว กรุณาแจ้ง Admin");
    var t = plAuthIssueToken_(em);
    console.log("เข้าสู่ระบบด้วยรหัสทางอีเมล: " + em + " (" + u.role + ")");
    return { ok: true, token: t.token, exp: t.exp, me: { email: em, name: u.name, role: u.role, via: "token" } };
  });
}

/* ---------------------------------------------------------------------
 * ประตูเดียวของหน้าเว็บ: plCall(token, ชื่อคำสั่ง, [ค่า])
 * ------------------------------------------------------------------- */

// สร้างตารางตอนเรียก (ไม่อ้างฟังก์ชันของไฟล์อื่นตอนโหลดไฟล์ — ลำดับไฟล์ในโปรเจกต์จะไม่มีผล)
// n = จำนวนค่าที่คำสั่งรับต่อจาก user
function plRpcTable_() {
  return {
    listPosterJobs: { f: plListPosterJobs_, n: 1 },
    getJob: { f: plGetJob_, n: 1 },
    getShipToOptions: { f: plGetShipToOptions_, n: 1 },
    createJob: { f: plCreateJob_, n: 3 },
    updateAdOn: { f: plUpdateAdOn_, n: 3 },
    planInstall: { f: plPlanInstall_, n: 3 },
    setShipDate: { f: plSetShipDate_, n: 3 },
    acknowledgeLate: { f: plAcknowledgeLate_, n: 2 },
    markShipped: { f: plMarkShipped_, n: 3 },
    markReceived: { f: plMarkReceived_, n: 3 },
    markInstalled: { f: plMarkInstalled_, n: 3 },
    uploadJobPhoto: { f: plUploadJobPhoto_, n: 2 },
    markProofSent: { f: plMarkProofSent_, n: 2 }
  };
}

function plCall(tok, fn, args) {
  return plApi_(function () {
    var table = plRpcTable_();
    if (typeof fn !== "string" || !Object.prototype.hasOwnProperty.call(table, fn)) throw plErr_("INVALID", "ไม่รู้จักคำสั่งนี้");
    var user = plCurrentUser_(tok);
    if (!user.email) throw plErr_("LOGIN_REQUIRED", "กรุณาเข้าสู่ระบบก่อนใช้งาน");
    var spec = table[fn];
    var a = Object.prototype.toString.call(args) === "[object Array]" ? args.slice(0, spec.n) : [];
    while (a.length < spec.n) a.push(undefined);
    return spec.f.apply(null, [user].concat(a));
  });
}

/* ---------------------------------------------------------------------
 * ตัวกันฟังก์ชันดูแลระบบ (ตั้ง trigger / โหมดทดสอบ / ชุดทดสอบ / setupSheets)
 * ผ่านได้เฉพาะ: เจ้าของสคริปต์ที่รันเอง (หน้า editor) หรือบัญชี Google ที่เป็น Admin ในแท็บ Users
 * คนที่เปิดลิงก์เว็บแอปโดยไม่ล็อกอิน → ระบบไม่เห็นอีเมล → ไม่ผ่าน
 * ------------------------------------------------------------------- */

function plIsAdminCaller_() {
  var active = "", effective = "";
  try { active = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase(); } catch (e) { }
  if (!active) return false;
  try { effective = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase(); } catch (e2) { }
  if (effective && active === effective) return true;
  var u = plUsers_()[active];
  return !!u && u.role === "Admin";
}

function plRequireAdminCaller_() {
  if (!plIsAdminCaller_()) {
    throw plErr_("FORBIDDEN", "คำสั่งดูแลระบบ: ใช้ได้เฉพาะเจ้าของสคริปต์หรือ Admin ที่ล็อกอินบัญชี Google · ถ้าคุณเป็นเจ้าของแต่เจอข้อความนี้ ให้รัน plWhoAmI หนึ่งครั้งเพื่อให้สิทธิ์อ่านอีเมล");
  }
}

// ฟังก์ชันที่ trigger ตามเวลาเรียก (plDailyDigest / plHourlyNotify) — ชื่อต้องไม่มี _ ท้าย trigger ถึงจะเรียกได้
// จึงถูกเปิดให้หน้าเว็บเรียกด้วย · ผ่านได้เฉพาะ: trigger จริงของโปรเจกต์ (เช็ค triggerUid กับรายการ trigger)
// หรือเจ้าของ/Admin ที่รันเอง · คนนอกเรียกผ่าน google.script.run → ส่ง triggerUid ปลอมมาก็ไม่ตรง → ไม่ผ่าน
function plRequireTriggerOrAdmin_(e) {
  var uid = e && (typeof e === "object") ? String(e.triggerUid || "") : "";
  if (uid) {
    var hit = ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; });
    if (hit) return;
  }
  plRequireAdminCaller_();
}

// บังคับทุกคนที่เข้าด้วยรหัสทางอีเมลให้เข้าสู่ระบบใหม่ (เช่น สงสัยว่า token หลุด) — รันจาก editor
function plAuthRevokeAll() {
  plRequireAdminCaller_();
  PropertiesService.getScriptProperties().deleteProperty("PL_AUTH_SECRET");
  console.log("ยกเลิก token ทั้งหมดแล้ว ทุกคนที่เข้าด้วยรหัสทางอีเมลต้องเข้าสู่ระบบใหม่");
}

/* ---------------------------------------------------------------------
 * รหัสผ่าน (ชื่อผู้ใช้หรืออีเมล + รหัสผ่าน)
 *  - แท็บ Users: A=email B=ชื่อ C=บทบาท D=ชื่อผู้ใช้ (ไม่บังคับ) · ไม่เก็บรหัสผ่านในชีต
 *  - รหัสผ่านเก็บเป็นแฮช+salt ใน Script Properties (PL_PW_<แฮชอีเมล>)
 *  - กรอกผิด PL_PW.FAIL_MAX ครั้ง → ล็อก PL_PW.LOCK_SEC วินาที
 * ------------------------------------------------------------------- */

var PL_PW = { ROUNDS: 500, MIN_LEN: 8, MAX_LEN: 100, FAIL_MAX: 5, LOCK_SEC: 900, ALPHABET: "abcdefghjkmnpqrstuvwxyz23456789" };
var PL_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

function plPwKey_(email) { return "PL_PW_" + plAuthSha_(email).slice(0, 32); }
function plPwMinKey_(email) { return "PL_TOKMIN_" + plAuthSha_(email).slice(0, 32); }

function plPwHash_(salt, pw, rounds) {
  var h = plAuthSha_(salt + "|" + pw);
  for (var i = 0; i < rounds; i++) h = plAuthSha_(h + "|" + salt + "|" + pw);
  return h;
}

// ตั้งรหัสผ่านใหม่ + ยกเลิก token เดิมของคนนี้ทั้งหมด
function plPwSet_(email, pw) {
  var p = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid();
  p.setProperty(plPwKey_(email), JSON.stringify({ s: salt, n: PL_PW.ROUNDS, h: plPwHash_(salt, pw, PL_PW.ROUNDS), at: Date.now() }));
  p.setProperty(plPwMinKey_(email), String(Date.now()));
}

function plPwHas_(email) { return !!PropertiesService.getScriptProperties().getProperty(plPwKey_(email)); }

// ไม่มีรหัสผ่านก็ยังคำนวณแฮชปลอมหนึ่งรอบ ให้ใช้เวลาใกล้เคียงกัน (ไม่บอกใบ้ว่าบัญชีมีอยู่ไหม)
function plPwCheck_(email, pw) {
  var raw = PropertiesService.getScriptProperties().getProperty(plPwKey_(email));
  if (!raw) { plPwHash_("none", pw, PL_PW.ROUNDS); return false; }
  var rec = JSON.parse(raw);
  return plAuthSame_(rec.h, plPwHash_(rec.s, pw, rec.n));
}

// รหัสผ่านสุ่ม 10 ตัว (ไม่มี 0/o/1/l/i) แบ่งครึ่งด้วยขีด เช่น k7m2p-x9qte
function plAuthNewPassword_() {
  var out = "";
  while (out.length < 10) {
    var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + "|" + Utilities.getUuid(), Utilities.Charset.UTF_8);
    for (var i = 0; i < b.length && out.length < 10; i++) {
      var v = b[i] & 255;
      if (v < 248) out += PL_PW.ALPHABET.charAt(v % PL_PW.ALPHABET.length);     // 248 = 31 × 8 (ไม่เอียง)
    }
  }
  return out.slice(0, 5) + "-" + out.slice(5);
}

/* แถวที่ไม่มีอีเมลแต่มี "ชื่อผู้ใช้" (คอลัมน์ D) = ผู้ใช้แบบไม่มีอีเมล: ใช้รหัสตัวตนภายใน <ชื่อผู้ใช้>@nomail.local
 * (ไม่ใช่อีเมลจริง — ระบบไม่ส่งอีเมลถึง) และล็อกอินด้วย ชื่อผู้ใช้ + รหัสผ่านในคอลัมน์ Password ของชีตได้ */
var PL_NOMAIL_DOMAIN = "nomail.local";
function plNoMailId_(username) {
  var u = String(username == null ? "" : username).trim().toLowerCase();
  return PL_USERNAME_RE.test(u) ? u + "@" + PL_NOMAIL_DOMAIN : "";
}
function plIsRealEmail_(id) {
  var s = String(id || "").toLowerCase();
  return !!s && s.slice(-(PL_NOMAIL_DOMAIN.length + 1)) !== "@" + PL_NOMAIL_DOMAIN;
}
// ตัวตนของแถวใน Users: มีอีเมล → อีเมล (ต้องรูปแบบถูก) · ไม่มีอีเมล → รหัสตัวตนจากชื่อผู้ใช้ · อื่น ๆ → ""
function plRowIdentity_(emailCell, usernameCell) {
  var raw = String(emailCell == null ? "" : emailCell).trim();
  return raw ? plAuthNormEmail_(raw) : plNoMailId_(usernameCell);
}

// รหัสผ่านที่กรอกในคอลัมน์ "Password" ของแท็บ Users (หาจากชื่อหัว) — ใช้ตรวจตอนล็อกอินเท่านั้น ไม่ส่งออกไปหน้าเว็บ
function plSheetPwCheck_(email, pw) {
  var sh = plSheet_(Config.SHEET_USERS), lastCol = sh.getLastColumn(), pwCol = 0;
  if (lastCol < 1) return false;
  sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].forEach(function (h, i) { if (!pwCol && /^password$/i.test(String(h || "").trim())) pwCol = i + 1; });
  if (!pwCol) return false;
  var row = 0;
  plUserRows_().forEach(function (r) { if (!row && r.email === email) row = r.row; });
  if (!row) return false;
  var stored = String(sh.getRange(row, pwCol).getDisplayValue() || "");
  return stored.length > 0 && plAuthSame_(stored, pw);
}

// อ่านแท็บ Users ทั้ง 5 คอลัมน์ → [{ email, name, role, username, status, row }]  (status: active | inactive)
function plUserRows_() {
  var sh = plSheet_(Config.SHEET_USERS), last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 5).getDisplayValues().forEach(function (r, i) {
    var email = plRowIdentity_(r[0], r[3]);
    if (!email) return;
    out.push({ email: email, name: String(r[1] || "").trim(), role: String(r[2] || "").trim(), username: String(r[3] || "").trim().toLowerCase(),
      status: plIsInactive_(r[4]) ? "inactive" : "active", row: i + 2 });
  });
  return out;
}

// ชื่อผู้ใช้หรืออีเมล → อีเมลของบัญชีที่มีบทบาทถูกต้อง · ไม่พบ → ""
function plFindLogin_(login) {
  var lg = String(login || "").trim().toLowerCase(), rows = plUserRows_();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (Config.ROLES.indexOf(r.role) < 0 || r.status === "inactive") continue;
    if (lg.indexOf("@") >= 0 ? r.email === lg : (r.username && r.username === lg)) return r.email;
  }
  return "";
}

function plAuthTokenResult_(email, u, extra) {
  var t = plAuthIssueToken_(email);
  var out = { ok: true, token: t.token, exp: t.exp, me: { email: email, name: u.name, role: u.role, via: "token" } };
  if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

// หน้าเว็บเรียก: เข้าสู่ระบบด้วยชื่อผู้ใช้/อีเมล + รหัสผ่าน
function plAuthLogin(login, password) {
  return plApi_(function () {
    var bad = "ชื่อผู้ใช้/อีเมล หรือรหัสผ่านไม่ถูกต้อง";
    var lg = String(login == null ? "" : login).trim().toLowerCase();
    var pw = String(password == null ? "" : password);
    if (!lg || lg.length > 254 || !pw || pw.length > PL_PW.MAX_LEN) throw plErr_("INVALID", bad);
    var cache = CacheService.getScriptCache(), fk = plAuthKey_("pl_pwf_", lg);
    var fails = Number(cache.get(fk) || 0);
    if (fails >= PL_PW.FAIL_MAX) throw plErr_("TOO_MANY", "กรอกผิดหลายครั้ง ลองใหม่ในอีก " + Math.round(PL_PW.LOCK_SEC / 60) + " นาที หรือให้ Admin รีเซ็ตรหัสผ่านให้");
    var email = plFindLogin_(lg);
    var ok = email ? (plPwCheck_(email, pw) || plSheetPwCheck_(email, pw)) : (plPwCheck_("nobody@invalid.test", pw), false);
    if (!ok) {
      cache.put(fk, String(fails + 1), PL_PW.LOCK_SEC);
      var left = PL_PW.FAIL_MAX - fails - 1;
      throw plErr_("INVALID", bad + (left > 0 ? " (เหลืออีก " + left + " ครั้ง)" : " · ล็อกชั่วคราว"));
    }
    cache.remove(fk);
    var u = plUsers_()[email];
    if (!u) throw plErr_("FORBIDDEN", "บัญชีนี้ไม่อยู่ในรายชื่อผู้ใช้แล้ว กรุณาแจ้ง Admin");
    console.log("เข้าสู่ระบบด้วยรหัสผ่าน: " + email + " (" + u.role + ")");
    return plAuthTokenResult_(email, u);
  });
}

// หน้าเว็บเรียก: เปลี่ยนรหัสผ่านของตัวเอง (เคยตั้งแล้วต้องใส่รหัสเดิม) · ได้ token ใหม่กลับไป (token เก่าถูกยกเลิก)
function plAuthChangePassword(tok, oldPw, newPw) {
  return plApi_(function () {
    var user = plCurrentUser_(tok);
    if (!user.email || !user.role) throw plErr_("LOGIN_REQUIRED", "กรุณาเข้าสู่ระบบก่อนใช้งาน");
    var np = String(newPw == null ? "" : newPw), op = String(oldPw == null ? "" : oldPw);
    if (np.length < PL_PW.MIN_LEN) throw plErr_("INVALID", "รหัสผ่านใหม่ต้องยาวอย่างน้อย " + PL_PW.MIN_LEN + " ตัวอักษร");
    if (np.length > PL_PW.MAX_LEN) throw plErr_("INVALID", "รหัสผ่านยาวเกินไป");
    if (/^(.)\1+$/.test(np)) throw plErr_("INVALID", "รหัสผ่านง่ายเกินไป");
    var cache = CacheService.getScriptCache(), fk = plAuthKey_("pl_pwf_", user.email);
    if (plPwHas_(user.email)) {
      var fails = Number(cache.get(fk) || 0);
      if (fails >= PL_PW.FAIL_MAX) throw plErr_("TOO_MANY", "กรอกรหัสเดิมผิดหลายครั้ง ลองใหม่ในอีก " + Math.round(PL_PW.LOCK_SEC / 60) + " นาที");
      if (!plPwCheck_(user.email, op)) { cache.put(fk, String(fails + 1), PL_PW.LOCK_SEC); throw plErr_("INVALID", "รหัสผ่านเดิมไม่ถูกต้อง"); }
      cache.remove(fk);
      if (op === np) throw plErr_("INVALID", "รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม");
    }
    plPwSet_(user.email, np);
    withLock_(function () { appendLog_([{ email: user.email, action: "เปลี่ยนรหัสผ่านของตัวเอง" }]); });
    return plAuthTokenResult_(user.email, { name: user.name, role: user.role });
  });
}

/* ---------------------------------------------------------------------
 * Admin: จัดการผู้ใช้ (เพิ่ม/แก้ผู้ใช้ + สร้าง/รีเซ็ตรหัสผ่านแบบสุ่ม แสดงครั้งเดียว)
 * ------------------------------------------------------------------- */

function plAdminUser_(tok) {
  var u = plCurrentUser_(tok);
  if (!u.email || !u.role) throw plErr_("LOGIN_REQUIRED", "กรุณาเข้าสู่ระบบก่อนใช้งาน");
  if (u.role !== "Admin") throw plErr_("FORBIDDEN", "เฉพาะ Admin เท่านั้น");
  return u;
}

function plAdminUsers(tok) {
  return plApi_(function () {
    plAdminUser_(tok);
    return {
      ok: true, roles: Config.ROLES,
      users: plUserRows_().map(function (r) { return { email: r.email, name: r.name, role: r.role, username: r.username, status: r.status, hasPassword: plPwHas_(r.email), roleOk: Config.ROLES.indexOf(r.role) >= 0 }; })
    };
  });
}

// o = { email, name, role, username, status } · อีเมลใหม่ → เพิ่มแถว + สร้างรหัสผ่านสุ่ม (คืนมาครั้งเดียว) · อีเมลเดิม → แก้ชื่อ/บทบาท/ชื่อผู้ใช้
function plAdminSaveUser(tok, o) {
  return plApi_(function () {
    var admin = plAdminUser_(tok);
    o = o || {};
    var email = plAuthNormEmail_(o.email);
    if (!email) throw plErr_("INVALID", "รูปแบบอีเมลไม่ถูกต้อง");
    var name = String(o.name == null ? "" : o.name).trim().slice(0, 60);
    var role = String(o.role == null ? "" : o.role).trim();
    if (Config.ROLES.indexOf(role) < 0) throw plErr_("INVALID", "บทบาทต้องเป็น " + Config.ROLES.join(" / "));
    var username = String(o.username == null ? "" : o.username).trim().toLowerCase();
    if (username && !PL_USERNAME_RE.test(username)) throw plErr_("INVALID", "ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–30 ตัว และขึ้นต้นด้วยตัวอักษรหรือตัวเลข");
    var status = o.status == null || o.status === "" ? "" : String(o.status).trim().toLowerCase();
    if (status && status !== "active" && status !== "inactive") throw plErr_("INVALID", "สถานะต้องเป็น active หรือ inactive");
    var password = "", created = false, finalStatus = "active";
    withLock_(function () {
      var rows = plUserRows_(), mine = null;
      rows.forEach(function (r) { if (r.email === email) mine = r; });
      if (username) rows.forEach(function (r) { if (r.username === username && r.email !== email) throw plErr_("INVALID", "ชื่อผู้ใช้ \"" + username + "\" มีคนใช้แล้ว"); });
      if (mine && email === admin.email && role !== "Admin") throw plErr_("INVALID", "ลดบทบาทของตัวเองจาก Admin ไม่ได้ (ให้ Admin คนอื่นทำ)");
      var newStatus = status || (mine ? mine.status : "active");
      finalStatus = newStatus;
      if (mine && email === admin.email && newStatus === "inactive") throw plErr_("INVALID", "ระงับบัญชีของตัวเองไม่ได้ (ให้ Admin คนอื่นทำ)");
      var sh = plSheet_(Config.SHEET_USERS);
      if (!String(sh.getRange(1, 4).getDisplayValue() || "").trim()) sh.getRange(1, 4).setValue("ชื่อผู้ใช้").setFontWeight("bold");
      if (!String(sh.getRange(1, 5).getDisplayValue() || "").trim()) sh.getRange(1, 5).setValue("สถานะ").setFontWeight("bold");
      var row = mine ? mine.row : Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(row, 1, 1, 5).setValues([[email, name, role, username, newStatus]]);
      created = !mine;
      if (mine && mine.status !== newStatus) PropertiesService.getScriptProperties().setProperty(plPwMinKey_(email), String(Date.now()));
      if (created) { password = plAuthNewPassword_(); plPwSet_(email, password); }
      else if (mine.role !== role) PropertiesService.getScriptProperties().setProperty(plPwMinKey_(email), String(Date.now()));   // เปลี่ยนบทบาท → ให้เข้าสู่ระบบใหม่
      appendLog_([{ email: admin.email, action: created ? "เพิ่มผู้ใช้ (Admin)" : "แก้ผู้ใช้ (Admin)", newVal: email + " · " + role + (username ? " · " + username : "") + (newStatus === "inactive" ? " · ระงับ" : "") }]);
    });
    plClearUsersCache_();
    var out = { ok: true, created: created, user: { email: email, name: name, role: role, username: username, status: finalStatus, hasPassword: plPwHas_(email) } };
    if (password) out.password = password;
    return out;
  });
}

// รีเซ็ตรหัสผ่านของผู้ใช้ในแท็บ Users → รหัสสุ่มใหม่ (คืนมาครั้งเดียว) + ยกเลิก token เดิมของคนนั้น
function plAdminResetPassword(tok, email) {
  return plApi_(function () {
    var admin = plAdminUser_(tok);
    var em = plAuthNormEmail_(email);
    var rows = plUserRows_(), found = null;
    rows.forEach(function (r) { if (r.email === em) found = r; });
    if (!found || Config.ROLES.indexOf(found.role) < 0) throw plErr_("NOT_FOUND", "ไม่พบผู้ใช้นี้ในแท็บ Users (หรือบทบาทไม่ถูกต้อง)");
    var password = plAuthNewPassword_();
    plPwSet_(em, password);
    CacheService.getScriptCache().remove(plAuthKey_("pl_pwf_", em));
    withLock_(function () { appendLog_([{ email: admin.email, action: "รีเซ็ตรหัสผ่านผู้ใช้ (Admin)", newVal: em }]); });
    return { ok: true, email: em, password: password };
  });
}

/* ---------------------------------------------------------------------
 * ตารางสิทธิ์ตามบทบาท (แท็บ "สิทธิ์" ในชีต) — แก้ได้โดยไม่ต้องแก้โค้ด
 *  แถว = ขั้นตอน (คอลัมน์ A = คีย์ เช่น create / shipDate / plan) · คอลัมน์ C ขึ้นไป = บทบาท
 *  ช่องที่มี ✓ (หรือ TRUE / x / 1 / yes / ใช่) = บทบาทนั้นกดขั้นนี้ได้ · Admin กดได้ทุกขั้นเสมอ
 *  ไม่มีแท็บ หรือไม่มีแถวของขั้นนั้น → ใช้ค่าตั้งต้นในโค้ด (PL_ACTIONS)
 *  ตรวจที่ server ทุกครั้ง · แก้ในชีตแล้วมีผลภายใน ~1 นาที (แก้ผ่านหน้าเว็บมีผลทันที)
 * ------------------------------------------------------------------- */

var PL_PERM_ROLES = ["AE", "Ops", "Production", "MA", "Installer"];       // Admin ไม่อยู่ในตาราง (ผ่านทุกขั้นเสมอ)
var PL_PERM_ON = /^(true|✓|✔|x|yes|y|1|ใช่|ได้)$/i;

// แคชแยกตามไฟล์ชีต (โหมดทดสอบใช้สำเนา — ห้ามปนกับของจริง)
function plPermCacheKey_() { return "pl_perms_v1_" + plAuthSha_(plSpreadsheetId_()).slice(0, 12); }
function plPermClearCache_() { CacheService.getScriptCache().remove(plPermCacheKey_()); }

// { คีย์ขั้นตอน: [บทบาท...] } จากแท็บสิทธิ์ · ไม่มีแท็บ → null
function plPermMatrix_() {
  var cache = CacheService.getScriptCache(), hit = cache.get(plPermCacheKey_());
  if (hit) return JSON.parse(hit).m;
  var m = null;
  try {
    var sh = plSpreadsheet_().getSheetByName(Config.SHEET_PERMS);
    if (sh && sh.getLastRow() >= 2 && sh.getLastColumn() >= 3) {
      var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
      var cols = [];
      head.forEach(function (h, i) { h = String(h || "").trim(); if (i >= 2 && PL_PERM_ROLES.indexOf(h) >= 0) cols.push({ i: i, role: h }); });
      m = {};
      sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getDisplayValues().forEach(function (r) {
        var key = String(r[0] || "").trim();
        if (!Object.prototype.hasOwnProperty.call(PL_ACTIONS, key)) return;
        m[key] = cols.filter(function (c) { return PL_PERM_ON.test(String(r[c.i] || "").trim()); }).map(function (c) { return c.role; });
      });
    }
  } catch (e) { m = null; }
  cache.put(plPermCacheKey_(), JSON.stringify({ m: m }), 60);
  return m;
}

function plActionRoles_(key) {
  var m = plPermMatrix_();
  return m && m[key] ? m[key].slice() : PL_ACTIONS[key].roles.slice();
}

// PL_ACTIONS ที่ใส่บทบาทจริงตามตารางสิทธิ์ ส่งให้หน้าจอซ่อน/แสดงปุ่ม (สิทธิ์จริงตรวจที่ server)
function plEffectiveActions_() {
  var out = {};
  Object.keys(PL_ACTIONS).forEach(function (k) {
    var a = PL_ACTIONS[k];
    out[k] = { label: a.label, roles: plActionRoles_(k), from: a.from };
  });
  return out;
}

function plAdminPermissions(tok) {
  return plApi_(function () {
    plAdminUser_(tok);
    var m = plPermMatrix_();
    return {
      ok: true, roles: PL_PERM_ROLES, source: m ? "sheet" : "default",
      actions: Object.keys(PL_ACTIONS).map(function (k) { return { key: k, label: PL_ACTIONS[k].label, roles: plActionRoles_(k) }; })
    };
  });
}

// matrix = { คีย์ขั้นตอน: [บทบาท...] } → เขียนแท็บสิทธิ์ (สร้างให้ถ้ายังไม่มี) · มีผลทันที
function plAdminSavePermissions(tok, matrix) {
  return plApi_(function () {
    var admin = plAdminUser_(tok);
    matrix = matrix || {};
    var keys = Object.keys(PL_ACTIONS), summary = [];
    keys.forEach(function (k) {
      var v = matrix[k];
      if (Object.prototype.toString.call(v) !== "[object Array]") throw plErr_("INVALID", "ตารางสิทธิ์ไม่ครบ (ขาดขั้นตอน " + k + ")");
      v.forEach(function (r) { if (PL_PERM_ROLES.indexOf(r) < 0) throw plErr_("INVALID", "บทบาท \"" + r + "\" ไม่อยู่ในตารางสิทธิ์"); });
    });
    withLock_(function () {
      var ss = plSpreadsheet_();
      var sh = ss.getSheetByName(Config.SHEET_PERMS) || ss.insertSheet(Config.SHEET_PERMS);
      var rows = [["คีย์", "ขั้นตอน"].concat(PL_PERM_ROLES)];
      keys.forEach(function (k) {
        var set = {}; matrix[k].forEach(function (r) { set[r] = 1; });
        rows.push([k, PL_ACTIONS[k].label].concat(PL_PERM_ROLES.map(function (r) { return set[r] ? "✓" : ""; })));
        summary.push(k + ":" + matrix[k].join("/"));
      });
      var oldLast = sh.getLastRow();
      if (oldLast > rows.length) sh.getRange(rows.length + 1, 1, oldLast - rows.length, Math.max(sh.getLastColumn(), rows[0].length)).clearContent();
      sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
      sh.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
      appendLog_([{ email: admin.email, action: "แก้ตารางสิทธิ์ (Admin)", newVal: summary.join(" · ") }]);
    });
    plPermClearCache_();
    return { ok: true, source: "sheet", actions: keys.map(function (k) { return { key: k, label: PL_ACTIONS[k].label, roles: plActionRoles_(k) }; }) };
  });
}
