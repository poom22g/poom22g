/* =====================================================================
 * Poster Logistics — Auth: เข้าสู่ระบบตามบทบาท + ตัวกันฟังก์ชันดูแลระบบ
 *
 * ใครคือผู้ใช้ (plCurrentUser_ ใน Logistics.gs):
 *   1) บัญชี Google ที่ระบบอ่านอีเมลได้ และอยู่ในแท็บ Users → ใช้ได้เลย ไม่ต้องกรอกอะไร
 *   2) นอกนั้น → เข้าสู่ระบบด้วย "อีเมล + รหัส 6 หลัก" ที่ส่งไปทางอีเมล (ต้องเป็นอีเมลในแท็บ Users)
 *      ผ่านแล้วได้ token อายุ PL_AUTH.SESSION_DAYS วัน เก็บในเครื่องผู้ใช้ และส่งมากับทุกคำสั่ง
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
    return plAuthSame_(p[3], plAuthSign_("v1|" + email + "|" + exp)) ? email : "";
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
    if (!u) return { ok: true, message: PL_AUTH_SENT_MSG };

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
    return { ok: true, token: t.token, exp: t.exp, me: { email: em, name: u.name, role: u.role, via: "otp" } };
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

// บังคับทุกคนที่เข้าด้วยรหัสทางอีเมลให้เข้าสู่ระบบใหม่ (เช่น สงสัยว่า token หลุด) — รันจาก editor
function plAuthRevokeAll() {
  plRequireAdminCaller_();
  PropertiesService.getScriptProperties().deleteProperty("PL_AUTH_SECRET");
  console.log("ยกเลิก token ทั้งหมดแล้ว ทุกคนที่เข้าด้วยรหัสทางอีเมลต้องเข้าสู่ระบบใหม่");
}
