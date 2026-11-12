# Security checklist — Dashboard Airport (Airport Static Media)

ผลตรวจเว็บแอป `/exec` จากภายนอก (ไม่ login): เปิดได้ HTTP 200 + ได้หน้าแอปเต็ม → deploy เป็น **Anyone**
และ `functionNames` เปิดให้ client เรียกได้ 61 ฟังก์ชัน

## 1. ตั้งค่า deployment (ทำใน Apps Script editor — ข้อนี้สำคัญที่สุด)

Deploy → Manage deployments → ✏️ → **Who has access: Anyone within planbmedia.co.th** → Deploy

- URL `/exec` เดิมใช้ต่อได้ ไม่ต้องแจกลิงก์ใหม่
- ถ้ามีผู้ใช้นอกโดเมน (Supplier / Installer) ที่ต้องเข้า Poster Logistics → แยกเป็น deployment ที่สองเฉพาะ Poster Logistics
  ห้ามเปิดทั้ง Dashboard เป็น Anyone เพื่อคนกลุ่มนี้
- ถ้า deployment เป็น **Execute as: User accessing the web app** → `plIsAdminCaller_` จะผ่านให้ทุกคน (active = effective)
  ต้องเป็น **Execute as: Me** เท่านั้น

## 2. แก้แล้วใน repo นี้ (`src/poster-logistics/`)

| ฟังก์ชัน | ก่อน | หลัง |
|---|---|---|
| `plDailyDigest`, `plHourlyNotify` | ใครก็เรียกได้ → ยิงอีเมลรัว / เผาโควต้า MailApp | ผ่านเฉพาะ trigger จริง (`triggerUid` ตรงกับ trigger ของโปรเจกต์) หรือเจ้าของ/Admin |
| `plClearUsersCache` | ใครก็ล้าง cache ได้ | ต้องเป็นเจ้าของ/Admin · ภายในโค้ดใช้ `plClearUsersCache_` |
| `plOnEditB` | รับ event ปลอมจากเว็บได้ | ต้องเป็น event จริงจากชีต (`e.range` มีเมธอด) |

ฟังก์ชันอื่นในโมดูลนี้ตรวจแล้ว มี guard ครบ (`plCall` / `plAdminUser_` / `plRequireAdminCaller_`)

นำขึ้นโปรเจกต์จริง: copy ไฟล์ `Auth.gs`, `Logistics.gs`, `Notify.gs`, `Triggers.gs`, `JobsTest.gs` ไปวางทับใน editor
(โฟลเดอร์นี้อยู่ใน `.claspignore` — `clasp push` จะไม่ส่งขึ้นให้) แล้ว **Deploy → New version** ใน deployment เดิม

## 3. `Code.gs` / `debug.gs` (แก้แล้วในโปรเจกต์จริง — ไฟล์ไม่อยู่ใน repo นี้)

ใส่ `requireViewer_()` (ผ่านเฉพาะ @planbmedia.co.th หรือเจ้าของ/Admin · ฉุกเฉินตั้ง Script Property `DASHBOARD_OPEN=1`)
ที่ฟังก์ชันอ่านข้อมูลทั้งหมด + `clearDashboardCache` · `awAuthorizeDrive` และ `debugSignCount` ใส่ `plRequireAdminCaller_()`
· `appsscript.json` เปลี่ยน `access` เป็น `DOMAIN` · `plTestNoMailLogin` ใส่ `plRequireAdminCaller_()`

ค้างเชิงออกแบบ: ผู้ใช้แบบไม่มีอีเมล (`@nomail.local`) เก็บรหัสผ่านเป็นข้อความธรรมดาในคอลัมน์ `Password` ของแท็บ Users
— ควรย้ายไปใช้รหัสผ่านแบบแฮชใน Script Properties (`plAdminResetPassword`) แล้วลบคอลัมน์นั้น

### รายการเดิม (อ้างอิง)

ฟังก์ชันเหล่านี้เปิดให้เรียกจากเว็บและหน้าเว็บเรียกโดยไม่ส่ง token:

| กลุ่ม | ฟังก์ชัน | ทำอะไร |
|---|---|---|
| ข้อมูลธุรกิจ | `getSignData`, `getDashboardSummary`, `getSalesSnapshot`, `getMtPhotos`, `getForeplan`, `getForeplanImage`, `getAwFiles`, `getUPCTeam`, `getAvailableYears` | ใส่ guard อ่าน (ด้านล่าง) |
| ดูแลระบบ | `clearDashboardCache`, `awAuthorizeDrive` | ใส่ `plRequireAdminCaller_()` บรรทัดแรก |
| debug / migration | `debugSignCount`, `plBackfillPreview`, `backfillStatus`, `plTestPhaseE`, `plTestNoMailLogin` | ลบ หรือเติม `_` ท้ายชื่อ หรือใส่ `plRequireAdminCaller_()` |

guard สำหรับฟังก์ชันอ่านข้อมูล (วางใน `Code.gs`):

```js
// ผ่านได้เฉพาะบัญชีโดเมนบริษัท หรือผู้ใช้ที่อยู่ในแท็บ Users (Google หรือ token)
function requireViewer_(tok) {
  var email = "";
  try { email = String(Session.getActiveUser().getEmail() || "").toLowerCase(); } catch (e) { }
  if (/@planbmedia\.co\.th$/.test(email)) return email;
  var u = plCurrentUser_(tok);
  if (u.email && u.role) return u.email;
  throw new Error("LOGIN_REQUIRED");
}

function getSignData(year, tok) {
  requireViewer_(tok);
  // ...โค้ดเดิม
}
```

หน้าเว็บ (`Dashboard.html`) ต้องส่ง token ต่อท้ายทุกการเรียก เช่น `google.script.run...getSignData(year, plToken)`
— ถ้าทำข้อ 1 แล้ว (Anyone within domain) guard นี้เป็นชั้นที่สอง ไม่บังคับต้องส่ง token

## 4. ตรวจซ้ำหลังแก้

```bash
curl -sS -o /dev/null -w "%{http_code} %{url_effective}\n" -L "<URL /exec>"
```

ต้องเด้งไป `accounts.google.com` (ไม่ใช่ 200 ที่หน้าแอป) = ข้อ 1 สำเร็จ
