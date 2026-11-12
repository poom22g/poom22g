# poom22g — Google Apps Script Project

โครงสร้างมาตรฐานสำหรับพัฒนา Google Apps Script ด้วย [clasp](https://github.com/google/clasp) + TypeScript

## โครงสร้างไฟล์

```
.
├── src/
│   ├── appsscript.json   # manifest ที่ push ขึ้น Apps Script
│   └── Code.ts           # entry point ตัวอย่าง
├── .clasp.json.example   # template สำหรับ .clasp.json (ห้าม commit ตัวจริง)
├── .claspignore          # กำหนดไฟล์ที่ push ขึ้น Apps Script
├── tsconfig.json
└── package.json
```

## เริ่มใช้งาน

```bash
npm install
npm run login        # clasp login (เปิด browser ให้ auth Google)

# เลือกอย่างใดอย่างหนึ่ง
cp .clasp.json.example .clasp.json && $EDITOR .clasp.json   # ใส่ scriptId ของโปรเจกต์เดิม
# หรือ
npm run create        # สร้าง Apps Script project ใหม่ (standalone), จะ gen .clasp.json ให้เอง
```

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run push` | push โค้ดจาก `src/` ขึ้น Apps Script |
| `npm run watch` | push อัตโนมัติเมื่อไฟล์เปลี่ยน |
| `npm run pull` | ดึงโค้ดจาก Apps Script ลงมา |
| `npm run open` | เปิด Apps Script editor ใน browser |
| `npm run deploy` | สร้าง deployment ใหม่ |
| `npm run typecheck` | ตรวจ type ด้วย tsc (ไม่ generate ไฟล์ output) |

## หมายเหตุ

- `.clasp.json` มี `scriptId` เฉพาะเครื่อง/เฉพาะโปรเจกต์ ไม่ commit เข้า git (อยู่ใน `.gitignore` แล้ว)
- ไฟล์ `.ts` ใน `src/` clasp จะ transpile เป็น `.gs` ให้อัตโนมัติตอน push — ไม่ต้อง build เอง
- ทุกไฟล์ใน Apps Script อยู่ใน global scope เดียวกัน ห้ามใช้ `import`/`export` ข้ามไฟล์ ตั้งชื่อฟังก์ชัน/ตัวแปรให้ไม่ชนกันแทน

## Poster Logistics (`src/poster-logistics/`)

สำเนาโค้ดระบบติดตามงานติดตั้ง Poster สนามบิน จากโปรเจกต์ Apps Script "Dashboard Airport" (เก็บไว้เป็น backup / version history)

| ไฟล์ | หน้าที่ |
|---|---|
| `Logistics.gs` | Config, หาคอลัมน์จากชื่อหัว, แปลงวันที่, lock, Log, สิทธิ์ตามบทบาท, `plSelfTest` |
| `Auth.gs` | เข้าสู่ระบบตามบทบาท (บัญชี Google หรืออีเมล + รหัส 6 หลัก), ประตู `plCall` ของหน้าเว็บ, ตัวกันฟังก์ชันดูแลระบบ |
| `Jobs.gs` | state machine ของงาน (สร้างงาน → ยืนยันกำหนดการ → ส่ง → รับ → ติดตั้ง → On air → ปิดงาน), อัปโหลดรูปเข้า Drive |
| `Notify.gs` | อีเมลสรุปประจำวัน 08:00, แจ้งเตือนรายชั่วโมง, ติดตั้ง/ลบ trigger |
| `Triggers.gs` | onEdit ของคอลัมน์ B "Status" (ติ๊กมือ / เอาติ๊กออก) |
| `JobsTest.gs` | ชุดทดสอบบนสำเนาชีต + `plUiTestOn` / `plUiTestOff` |
| `PosterLogistics.html` | หน้าจอ (4 มุมมอง, ตามบทบาท, รองรับมือถือ) |

ข้อควรรู้:

- **รหัสชีตถูกตัดออก** — `PL_REAL_SPREADSHEET_ID_` ใน `Logistics.gs` และ `PL_TEST_SPREADSHEET_DEFAULT` ใน `JobsTest.gs` เป็น placeholder ต้องใส่ค่าจริงก่อนใช้งาน และอย่า commit ค่าจริงกลับเข้า repo นี้
- **ไม่ครบทั้งโปรเจกต์** — โค้ดชุดนี้เรียกใช้ฟังก์ชันจาก `Code.gs` และถูกโหลดจาก `Dashboard.html` ของโปรเจกต์เดิม ซึ่งไม่ได้อยู่ใน repo นี้
- **ไม่ถูก `clasp push`** — โฟลเดอร์นี้อยู่ใน `.claspignore` เพื่อกันการ push ไปทับโปรเจกต์จริงโดยไม่ตั้งใจ
- Script Properties ที่ใช้: `PL_AUTH_SECRET` (ระบบสร้างเอง ห้ามเปิดเผย), `PHOTO_FOLDER_ID`, `OPS_HEAD_EMAIL` (ไม่บังคับ), `NOTIFY_REDIRECT_TO` (ไม่บังคับ), `WEBAPP_URL` (ไม่บังคับ), `PL_UI_TEST_SPREADSHEET_ID` (เฉพาะโหมดทดสอบ)

### การเข้าสู่ระบบ

- บทบาทของแต่ละคนกำหนดในแท็บ `Users` ของชีต (email | ชื่อ | บทบาท) — ลบออกจากแท็บ = หมดสิทธิ์ทันที
- ถ้าระบบเห็นบัญชี Google ของผู้ใช้และอีเมลอยู่ใน `Users` → ใช้ได้เลย
- นอกนั้นต้องเข้าสู่ระบบด้วยอีเมล + รหัส 6 หลักที่ส่งทางอีเมล (ใช้ได้ 10 นาที, ผิดได้ 5 ครั้ง, ขอใหม่ได้นาทีละครั้ง) แล้วได้ token อายุ 30 วัน
- ไม่รู้ว่าเป็นใคร → ทุกคำสั่งของหน้าเว็บตอบ `LOGIN_REQUIRED` (รวมการอ่านรายการงาน)
- ฟังก์ชันดูแลระบบ (`plInstallTriggers`, `plRemoveTriggers`, `plUiTestOn/Off`, `setupSheets`, `plSelfTest`, ชุดทดสอบ) รันได้เฉพาะเจ้าของสคริปต์จาก editor หรือบัญชี Google ที่เป็น Admin
- `plAuthRevokeAll` (รันจาก editor) = บังคับทุกคนที่เข้าด้วยรหัสทางอีเมลให้เข้าสู่ระบบใหม่

### ลำดับงาน

1. **AE** สร้างงาน + ใส่วัน Ad on → `รอกำหนดวันส่ง`
2. **Admin** คุยกับโรงพิมพ์ แล้วกำหนดวันส่ง → `รอ MA แจ้งแผน`
3. **MA** แจ้งแผนติดตั้ง (จุดส่ง, ผู้รับ, วันติดตั้ง — ต้องไม่ก่อนวันส่ง, ทีมติดตั้ง — ติดเอง หรือส่ง Supplier) → `มีกำหนด` (ถ้าติดตั้งหลัง Ad on → `รอ AE รับทราบ` ก่อน)
4. **Ops / Production** กด `ส่งแล้ว` + เลขพัสดุ → **MA / Ops** กด `ได้รับของแล้ว` → **MA / Installer / Ops** กด `ติดตั้งแล้ว` + รูป
5. ถึงวัน Ad on ระบบเปลี่ยนเป็น `On air` → **AE** กด `ส่ง Proof แล้ว` → `ปิดงาน`

แก้วันส่งก่อน MA แจ้งแผนได้เลย · แก้วันส่ง / แผนติดตั้ง หลังกำหนดการครบแล้วต้องใส่เหตุผล
