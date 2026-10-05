# NO CHILL — Backend

REST API ของ [NO CHILL](https://github.com/kwank6704/NOCHILL) แอปหายใจสาย Anti-Mindfulness

- Express 5 + SQLite ผ่าน `@libsql/client` — เครื่องตัวเองใช้ไฟล์ `database/nochill.db`, production ใช้ [Turso](https://turso.tech)
- `database/schema.sql`, `seed.sql`, `migrations/` — สร้างและ seed ฐานข้อมูลให้เองตอนเปิดครั้งแรก
- schema เวอร์ชันเก็บในตาราง `meta` และอัปเกรด DB เก่าให้อัตโนมัติ

## รัน

```bash
npm install
npm run dev       # http://localhost:4000/api
npm run db:reset  # ล้างและ seed ใหม่
```

| env | ค่าเริ่มต้น | |
|---|---|---|
| `PORT` | `4000` | |
| `CORS_ORIGIN` | `http://localhost:3000` | origin ของ frontend |
| `NOCHILL_DB` | `database/nochill.db` | ไฟล์ฐานข้อมูล (เมื่อไม่ได้ใช้ Turso) |
| `TURSO_DATABASE_URL` | — | เช่น `libsql://nochill-xxx.turso.io` |
| `TURSO_AUTH_TOKEN` | — | token ของ Turso |

## Deploy (Vercel)

`api/index.js` + `vercel.json` ทำให้ทั้งแอปรันเป็น serverless function ตั้ง `TURSO_DATABASE_URL` และ `TURSO_AUTH_TOKEN` ใน Vercel → Settings → Environment Variables แล้ว redeploy — ตารางและข้อมูลตัวอย่างจะถูกสร้างให้เองตอนเรียกครั้งแรก ถ้าไม่ตั้ง จะใช้ฐานข้อมูลชั่วคราวใน `/tmp` (รีเซ็ตบ่อย `/api/health` จะบอก `storage: ephemeral`)

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | |
| GET | `/api/roasts` | คำแซะทั้งหมด แยกหมวด |
| POST | `/api/roasts/events` | บันทึกว่าโดนแซะ `{clientId, category}` |
| POST | `/api/sessions` | บันทึกรอบ `{clientId, mode, holdMs, peakPressure, items?, grievance?, keystrokes?, keyboards?}` — ค่าเสียหายคำนวณฝั่ง server |
| GET | `/api/stats?clientId=` | สถิติรวม + ของผู้ใช้ |
| GET | `/api/grievances` | กำแพงความเซ็ง (public เท่านั้น) |
