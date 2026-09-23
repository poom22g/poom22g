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
