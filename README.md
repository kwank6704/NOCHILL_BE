# NO CHILL — Backend

REST API ของ [NO CHILL](https://github.com/kwank6704/NOCHILL) แอปหายใจสาย Anti-Mindfulness

- Express 5 + SQLite ผ่าน `node:sqlite` (มากับ Node ≥ 22.13 ไม่ต้องคอมไพล์ native module)
- `database/schema.sql`, `seed.sql`, `migrations/` — สร้างและ seed ฐานข้อมูลให้เองตอนเปิดครั้งแรก
- schema เวอร์ชันเก็บใน `PRAGMA user_version` และอัปเกรด DB เก่าให้อัตโนมัติ

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
| `NOCHILL_DB` | `database/nochill.db` | ไฟล์ฐานข้อมูล |

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | |
| GET | `/api/roasts` | คำแซะทั้งหมด แยกหมวด |
| POST | `/api/roasts/events` | บันทึกว่าโดนแซะ `{clientId, category}` |
| POST | `/api/sessions` | บันทึกรอบ `{clientId, mode, holdMs, peakPressure, items?, grievance?, keystrokes?, keyboards?}` — ค่าเสียหายคำนวณฝั่ง server |
| GET | `/api/stats?clientId=` | สถิติรวม + ของผู้ใช้ |
| GET | `/api/grievances` | กำแพงความเซ็ง (public เท่านั้น) |
