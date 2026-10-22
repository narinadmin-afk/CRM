# CMR Base — ระบบจัดการลูกค้า (CRM)

เว็บแอปจัดการข้อมูลลูกค้า ออกแบบตามแนวคิดของ **kintone**: ข้อมูลอยู่ในรูป "ระเบียน" (Records)
ที่ประกอบด้วย "ฟิลด์" (Fields) กำหนดเองได้, มีมุมมองหลายแบบ, ขั้นตอนการขาย, ความเคลื่อนไหวรายระเบียน,
นำเข้า/ส่งออก CSV, **ระบบ Login พร้อมกำหนดสิทธิ์ผู้ใช้ (admin / member / viewer)**
และเปิดผ่าน REST API

หน้าเว็บเป็นภาษาไทยทั้งหมด ไม่ใช้ framework ไม่ต้อง `npm install` (ไม่มี dependency ภายนอก)

---

## รันใช้งาน

```bash
node server.js
```

> **Backend แยกต่างหาก (MySQL)**: ถ้าต้องการระบบ API ที่เก็บข้อมูลลง MySQL ตามโครงสร้าง
> mvc (config/controllers/models/routes/middleware) พร้อม SQL script และฟอร์มตัวอย่าง
> ดูที่ [backend/README.md](backend/README.md) — รันแยกคนละพอร์ต ไม่กระทบแอปตัวนี้

แล้วเปิดเบราว์เซอร์ที่ **http://localhost:3000**

- เปลี่ยนพอร์ต: `PORT=3001 node server.js`
- ข้อมูลถูกเก็บลงฐานข้อมูล **MySQL** (ฐานข้อมูล `cmr` — ดู/แก้ข้อมูลผ่าน phpMyAdmin ได้)
- ตั้งค่าการเชื่อมต่อในไฟล์ `.env` (คัดลอกจาก `.env.example` แล้วเติมค่าของคุณ):
  `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT`
- อยากชี้ไปฐานข้อมูลอื่น (เช่น ตอนทดสอบ): `CMR_DB_NAME=other_db node server.js`
- โครงสร้างตารางอยู่ที่ `sql/schema.mysql.sql` (เซิร์ฟเวอร์สร้างให้อัตโนมัติตอนเริ่ม)
- ครั้งแรกที่รันจะเติมข้อมูลลูกค้าตัวอย่างภาษาไทยให้อัตโนมัติ 16 ระเบียน
- **สร้างบัญชีแรกผ่าน API**: เมื่อยังไม่มีผู้ใช้ ให้เรียก `POST /api/auth/register`
  (บัญชีแรกได้สิทธิ์ `admin` อัตโนมัติ) หลังจากนั้นเพิ่มผู้ใช้ต่อได้ในหน้า **จัดการผู้ใช้** — หน้าเว็บมีเฉพาะหน้าเข้าสู่ระบบ

### โหมดเก็บข้อมูล 2 แบบ (สลับได้)

| โหมด | เงื่อนไข | ข้อมูลอยู่ที่ |
|---|---|---|
| **API + MySQL** | เปิดผ่าน `node server.js` (ค่าเริ่มต้น ระบบเลือกให้อัตโนมัติ) | ฐานข้อมูล MySQL `cmr` แชร์กันได้ทุกเครื่องในเครือข่าย + ดูผ่าน phpMyAdmin ได้ |
| **localStorage** | เปิด `index.html` ตรง ๆ (file://) หรือใส่ `?storage=local` | เบราว์เซอร์เครื่องเดียว ไม่ต้องมีเซิร์ฟเวอร์ |

บาร์สถานะที่มุมล่างซ้ายของsidebar บอกว่าตอนนี้ใช้โหมดไหน
ทั้งสองโหมดใช้ interface ชุดเดียวกันใน [js/store.js](js/store.js) จึงเพิ่ม storage ใหม่ได้โดยไม่ต้องแก้ UI

> หมายเหตุ: ระบบผู้ใช้/สิทธิ์ทำงานเฉพาะโหมด **API + MySQL** เพราะโหมด localStorage
> เป็นคนละเครื่องคนละเบราว์เซอร์ (โหมดนั้นจึงใช้สิทธิ์เต็มรูปแบบและซ่อนเมนูผู้ใช้)

---

## Deploy บน Render

ตั้งค่าบน Render Dashboard (Web Service → เชื่อม repo นี้):

| รายการ | ค่า |
|---|---|
| Root Directory | `/` |
| Node version | อ่านจาก [`.nvmrc`](.nvmrc) อัตโนมัติ |
| Start Command | `npm start` |
| **Health Check Path** (Settings → Health Checks) | **`/api/health`** |
| Environment | `DATABASE_URL` = connection string ทั้งก้อนของ MySQL |

- `.env` **ไม่ถูก push ขึ้น git** — ค่า DB ต้องตั้งที่ Environment ของ Dashboard เท่านั้น
  (หรือแยกเป็น `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`) และกด **Redeploy** ทุกครั้งที่แก้ค่า
- MySQL บน Render มีเฉพาะแผนแบบมีค่าใช้จ่าย — ถ้าใช้ free plan ให้ต่อ MySQL ภายนอก (เช่น Aiven) แล้วเอา URL มาใส่ `DATABASE_URL`
- SSL เปิดอัตโนมัติเมื่อ host ไม่ใช่ localhost ถ้า certificate ตรวจสอบไม่ผ่านให้ตั้ง `DB_SSL_REJECT_UNAUTHORIZED=0`
- `/api/health` ตอบ 200 ได้ก็ต่อเมื่อเซิร์ฟเวอร์ต่อ MySQL + สร้างตารางสำเร็จแล้ว
  (ตอน start ต่อ DB ไม่ได้จะ exit 1 ทันที) Render ใช้ endpoint นี้ตัดสินว่า deploy สำเร็จหรือไม่
- รอบแรกหลัง deploy: ระบบสร้างตาราง + seed ข้อมูลตัวอย่างให้เอง แล้วสมัครบัญชีแรกผ่าน
  `POST /api/auth/register` (บัญชีแรกได้สิทธิ์ admin)

---

## ความสามารถ

**ข้อมูลลูกค้า**
- ระเบียนลูกค้า 17 ฟิลด์ (รหัสลูกค้า, ชื่อบริษัท, ผู้ติดต่อ, อีเมล, เบอร์โทร, สถานะ, แหล่งที่มา,
  ผู้รับผิดชอบ, มูลค่าดีล, ความสำคัญ, นัดครั้งถัดไป, อุตสาหกรรม, จังหวัด, ที่อยู่, บันทึก …)
- ประเภทฟิลด์: ข้อความ, ข้อความหลายบรรทัด, ตัวเลข, อีเมล, เบอร์โทร, เว็บไซต์, วันที่,
  เลือกอย่างเดียว, หลายตัวเลือก, สถานะ (ขั้นตอน)
- **ตั้งค่าฟิลด์เอง**: เพิ่ม/ลบ/แก้ไข/เรียงลำดับฟิルドได้ พร้อมบังคับกรอกและชุดตัวเลือก
  (เหมือนการตั้งค่า App บน kintone)

**มุมมอง**
- แดชบอร์ด: KPI (จำนวนลูกค้า, มูลค่าดีลรวม, ดีลที่ปิดแล้ว, นัดหมายที่จะถึง),
  กราฟสถิติตามสถานะ, งานของแต่ละคน, อัปเดตล่าสุด, นัดหมายครั้งถัดไป
- รายการ (ตาราง): เรียงตามคอลัมน์ใดก็ได้, ค้นหาด่วน, กรองตามสถานะ/ผู้รับผิดชอบ, เลื่อนดูแนวนอน
- การ์ด (gallery)
- **ขั้นตอนการขาย (kanban)**: ลากการ์ดข้ามคอลัมน์เพื่อเปลี่ยนสถานะ — บันทึกเป็น activity ให้เอง

**ระเบียน**
- หน้ารายละเอียดครบชุด + สรุปข้อมูลโดยย่อ
- เปลี่ยนสถานะจากหน้ารายละเอียดได้ทันที
- **ความเคลื่อนไหว/บันทึก**: คอมเมนต์, ประวัติแก้ไข, ประวัติเปลี่ยนสถานะ เก็บครบทุกประวัติ

**นำเข้า/ส่งออก**
- ส่งออก CSV (เขียน BOM เปิดด้วย Excel ภาษาไทยได้ทันที)
- นำเข้า CSV พร้อมหน้าตัวอย่าง 5 แถว และจับคู่คอลัมน์ด้วยชื่อฟิลด์อัตโนมัติ
- ดาวน์โหลดแม่แบบ CSV

---

## ผู้ใช้และสิทธิ์ (Login)

- **เพิ่มผู้ใช้**: ผ่านหน้า **จัดการผู้ใช้** (admin) หรือ API `POST /api/auth/register`
  (บัญชีแรก = `admin`, บัญชีถัดไป = `member`) — หน้าเว็บไม่มีหน้าสมัครสมาชิก มีเฉพาะหน้าเข้าสู่ระบบ `#/login`
- **เข้าสู่ระบบ**: หน้า `#/login` — รหัสผ่านเก็บเป็น hash ด้วย **scrypt + salt** (ไม่มีรหัสผ่านจริงในฐานข้อมูล)
- **เซสชัน**: cookie `cmr_session` เป็น `HttpOnly` + `SameSite=Lax` อายุ 7 วัน (เก็บในตาราง `sessions`)
  - ยังรองรับ `Authorization: Bearer <token>` สำหรับเรียก API จากโปรแกรมอื่น
  - หมดอายุ / ถูกระงับ /  logout → คำขอถัดไปได้ 401 แล้วหน้าเว็บจะพาไปหน้า Login ให้เอง
- **บังคับทั้งฝั่่งเซิร์ฟเวอร์และฝั่ง UI**: ปุ่มที่ไม่มีสิทธิ์จะไม่ถูกแสดง และ endpoint ก็ยังตรวจซ้ำอีกชั้น
  (ทดสอบยืนยันแล้วว่าเรียกตรงด้วย curl ได้ 403)

| บทบาท | ดู/ค้นหา/ส่งออก CSV | เพิ่มระเบียน | แก้ไข/เปลี่ยนสถานะ | ลบระเบียน | คอมเมนต์ | ตั้งค่าฟิลด์ / จัดการผู้ใช้ |
|---|---|---|---|---|---|---|
| **admin** (ผู้ดูแลระบบ) | ✔ | ✔ | ✔ ทุกฉบับ | ✔ ทุกฉบับ | ✔ | ✔ |
| **member** (สมาชิก) | ✔ | ✔ | เฉพาะที่ตัวเองสร้าง หรือที่เป็น "ผู้รับผิดชอบ" | เฉพาะที่ตัวเองสร้าง | ✔ | ✘ |
| **viewer** (ผู้ชม) | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |

หน้า **จัดการผู้ใช้** (เฉพาะ admin): เพิ่มผู้ใช้, เปลี่ยนบทบาท, ระงับ/เปิดใช้งาน (ระงับ = เด้งออกทันที),
เปลี่ยนรหัสผ่าน, ลบบัญชี — มีกฎเซฟ: ลบ/ระงับตัวเองไม่ได้ และต้องเหลือ admin อย่างน้อย 1 คน

---

## REST API

| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/api/health` | สาธารณะ | ตรวจสถานะเซิร์ฟเวอร์ |
| GET | `/api/auth/setup` | สาธารณะ | `has_users` — ใช้ตรวจว่ามีผู้ใช้ในระบบแล้วหรือยัง |
| POST | `/api/auth/register` | สาธารณะ | สร้างผู้ใช้ `{ username, display_name, email, password }` (บัญชีแรก = admin) — เรียกผ่าน API เท่านั้น ไม่มีหน้าสมัครใน UI |
| POST | `/api/auth/login` | สาธารณะ | เข้าสู่ระบบ `{ username, password }` → คืน cookie + user |
| GET | `/api/auth/me` | สาธารณะ | คืน `{ user }` หรือ `{ user: null }` |
| POST | `/api/auth/logout` | สมาชิก | ลบเซสชัน |
| GET | `/api/users` | admin | รายชื่อผู้ใช้ + จำนวนระเบียนที่สร้าง |
| POST | `/api/users` | admin | เพิ่มผู้ใช้ `{ username, display_name, password, role }` |
| PATCH | `/api/users/:id` | admin | เปลี่ยน `role` / `active` / `password` / `display_name` / `email` |
| DELETE | `/api/users/:id` | admin | ลบผู้ใช้ |
| GET | `/api/app` | สมาชิก | ดูโครงสร้างฟิลด์ (schema) |
| PUT | `/api/app` | admin | บันทึกโครงสร้างฟิลด์ |
| GET | `/api/records` | สมาชิก | รายการระเบียนทั้งหมด |
| POST | `/api/records` | member/admin | สร้างระเบียน `{ values: {...} }` (บันทึกผู้สร้าง + ตั้งผู้รับผิดชอบอัตโนมัติ) |
| GET | `/api/records/:id` | สมาชิก | ดูระเบียนเดียว |
| PUT | `/api/records/:id` | member/admin* | แก้ไขระเบียน (ตามตารางสิทธิ์ด้านบน) |
| DELETE | `/api/records/:id` | member/admin* | ลบระเบียน (ตามตารางสิทธิ์ด้านบน) |
| POST | `/api/records/:id/comments` | member/admin | เพิ่มคอมเมนต์ `{ text }` |
| POST | `/api/records/:id/status` | member/admin* | เปลี่ยนสถานะ `{ status }` |
| POST | `/api/reset` | admin | ล้างและเติมข้อมูลตัวอย่างใหม่ — เรียกผ่าน API เท่านั้น ไม่มีปุ่มใน UI |

\* ต้องเป็นเจ้าของระเบียน (คนสร้าง) หรือ "ผู้รับผิดชอบ" เว้นแต่เป็น admin

ตัวอย่างเรียก API ด้วย token:

```bash
# เข้าสู่ระบบแล้วใช้ cookie ที่ได้กลับไปเรียก API
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"***"}' -c - | grep cmr_session | awk '{print $7}')

curl http://localhost:3000/api/records -H "Cookie: cmr_session=$TOKEN"
curl -X POST http://localhost:3000/api/records \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"values":{"customer_code":"C-2001","company":"บริษัทใหม่ จำกัด","status":"Lead"}}'
```

---

## โครงสร้างโปรเจกต์

```
index.html          โครงหน้าเว็บ (sidebar + จุดสำหรับ render)
css/app.css         สไตล์ทั้งหมด
js/ui.js            helper สร้าง DOM, toast, modal, จัดรูปแบบวันที่/ตัวเลข
js/csv.js           แปลง/สร้าง CSV (รองรับเครื่องหมายคำพูด ขึ้นบรรทัดใหม่ BOM)
js/auth.js          apiFetch + Auth (login/logout/จัดการผู้ใช้) + ตรวจสอบสิทธิ์ฝั่ง UI
js/store.js         ชั้นเก็บข้อมูล: LocalStorageStore / ApiStore (เลือกอัตโนมัติ)
js/app.js           router + ทุกมุมมอง (login, users, dashboard, records, kanban, detail, form, settings)
shared/seed.js      schema เริ่มต้น + ข้อมูลตัวอย่าง (ใช้ร่วม browser/server)
.env                ค่าเชื่อมต่อ MySQL (ไม่ถูก commit ลง git)
server.js           Node http server: เสิร์ฟไฟล์ + REST API + MySQL + auth/สิทธิ์
sql/schema.mysql.sql  โครงสร้างฐานข้อมูล (meta/records/users/sessions)
tests/api.test.mjs        ชุดทดสอบ REST API (24 assertions)
tests/auth.test.mjs       ชุดทดสอบ Login/Register + ตารางสิทธิ์ (46 assertions)
tests/lifecycle.test.mjs  ชุดทดสอบพฤติกรรมระเบียนตลอดชีวิต + รีสตาร์ทเซิร์ฟ (27 assertions)
data/cmr.sqlite     สำเนาฐานข้อมูลเดิม (ก่อนย้ายมา MySQL เก็บไว้อ้างอิง)
```

## คำสั่งตรวจสอบ

```bash
npm run check           # syntax check ทุกไฟล์ JS
npm test                # ชุดทดสอบ REST API (24 assertions)
npm run test:auth       # ชุดทดสอบสิทธิ์ผู้ใช้ (46 assertions)
npm run test:lifecycle  # ทดสอบพฤติกรรมจริง: สร้าง→คอมเมนต์→เปลี่ยนสถานะ→แก้ไข→ลบ→รีสตาร์ท (27 assertions)
npm run test:all        # รันทั้งสามชุด (97 assertions)
```

ทั้งสามชุดรันบนเซิร์ฟเวอร์ชั่วคราว (พอร์ต 3999 / 3997 / 3998) โดยใช้ database ชั่วคราว
`cmr_test_api` / `cmr_test_auth` / `cmr_test_lifecycle` แล้ว DROP ทิ้งตอนจบ
⇒ จบด้วยข้อมูลจริงในฐาน `cmr` คงเดิม 100%

## แนวทางต่อยอด

- ประวัติการแก้ไขแบบ audit log (diff ทีละค่า) และรายงานการเข้าใช้งาน
- แอปอื่น ๆ นอกเหนือจากทะเบียนลูกค้า (งาน ใบสั่งซื้อ ผู้ขาย) — ปัจจุบัน schema ต่อแอปอยู่ใน `meta`
- รายงาน/กราฟส่งออก PNG, แจ้งเตือนนัดหมาย, ซิงก์ปฏิทิน
