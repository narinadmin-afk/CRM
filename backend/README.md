# Backend — ระบบ CRM (MySQL + Express)

REST API สำหรับบันทึกข้อมูลลูกค้าลงฐานข้อมูล MySQL
แยกจาก Frontend อย่างชัดเจน: ตัวอย่างฟอร์มอยู่ที่ [`../frontend/customer-form.html`](../frontend/customer-form.html)

## โครงสร้างโปรเจกต์

```
backend/
├── config/
│   ├── db.js            # เชื่อมต่อ MySQL (อ่านค่าจาก .env + Connection Pool)
│   └── constants.js     # ค่าคงที่: สถานะลูกค้า, whitelist คอลัมน์, ข้อจำกัดความยาว
├── controllers/
│   └── customerController.js  # จัดการ Request/Response ของลูกค้า
├── models/
│   └── customerModel.js       # คำสั่ง SQL ทั้งหมด (Prepared Statements)
├── routes/
│   └── customerRoutes.js      # เส้นทาง API ทั้ง 6 เส้นทาง
├── middleware/
│   ├── validate.js            # ตรวจสอบข้อมูลก่อนบันทึก (Validation)
│   └── errorHandler.js        # จัดการ Error กลาง (ไม่เปิดเผยรายละเอียด DB)
├── sql/
│   ├── schema.sql             # สคริปต์สร้าง Database + ตาราง customers
│   └── init.js                # รัน schema.sql อัตโนมัติ (ไม่ต้องมี mysql client)
├── .env.example               # แม่แบบ Environment Variables
└── server.js                  # จุดเริ่มเซิร์ฟเวอร์ (Express)
```

## ขั้นตอนติดตั้ง

### 1. ติดตั้ง MySQL

- **Windows**: ติดตั้งจาก [dev.mysql.com/downloads/installer](https://dev.mysql.com/downloads/installer/) หรือ XAMPP (มี MySQL มาให้)
- **macOS**: `brew install mysql && brew services start mysql`
- **Ubuntu/Debian**: `sudo apt install mysql-server && sudo systemctl start mysql`

ตั้งรหัสผ่าน root ให้เรียบร้อย (หรือใช้ user อื่นที่มีสิทธิ์ CREATE DATABASE)

### 2. ตั้งค่า Environment Variables

```bash
cd backend
cp .env.example .env     # Windows: copy .env.example .env
```

แล้วแก้ `.env` ให้ตรงของจริง:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password   # รหัสผ่าน MySQL ของคุณ
DB_NAME=crm_customers       # ชื่อฐานข้อมูล (สร้างให้อัตโนมัติตอน step 3)
DB_PORT=3306
PORT=5000
CLIENT_ORIGIN=              # เว้นว่าง = อนุญาตทุกแหล่ง (ตอนพัฒนา)
```

> **ความปลอดภัย**: ไฟล์ `.env` อยู่ใน `.gitignore` แล้ว — ห้าม commit รหัสผ่านลง git

### 3. สร้าง Database และตาราง

```bash
npm run db:init
```

จะรัน `sql/schema.sql` ให้อัตโนมัติ (สร้างฐานข้อมูล `DB_NAME` + ตาราง `customers`)
หรือจะนำเข้า `sql/schema.sql` ผ่าน MySQL Workbench / phpMyAdmin ก็ได้

### 4. ติดตั้งแพ็กเกจและรัน

```bash
npm install
npm start          # หรือ npm run dev (reload อัตโนมัติตอนแก้ไข)
```

เซิร์ฟเวอร์จะ**ตรวจการเชื่อมต่อ DB ก่อนเริ่ม** — ถ้าเชื่อมไม่ได้จะบอกสาเหตุแล้วหยุด

### 5. เปิดฟอร์มตัวอย่าง

เปิดไฟล์ `frontend/customer-form.html` ในเบราว์เซอร์ (เปิดตรง ๆ ได้เลย)
แล้วกรอกข้อมูลทดสอบ — ถ้า backend รันอยู่ที่พอร์ต 5000 จะบันทึกลง MySQL ทันที

## API ทั้งหมด

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/health` | ตรวจสถานะเซิร์ฟเวอร์ |
| GET | `/api/customers` | ดึงข้อมูลทั้งหมด (`?search=คำค้น&status=สถานะ`) |
| GET | `/api/customers/search?q=คำค้น` | ค้นหาลูกค้า |
| GET | `/api/customers/:id` | ดึงข้อมูลรายบุคคล |
| POST | `/api/customers` | เพิ่มลูกค้า |
| PUT | `/api/customers/:id` | แก้ไขข้อมูลลูกค้า (ส่งเฉพาะฟิลด์ที่เปลี่ยนก็ได้) |
| DELETE | `/api/customers/:id` | ลบลูกค้า |

### รูปแบบ Response

สำเร็จ:

```json
{ "success": true, "message": "บันทึกข้อมูลสำเร็จ", "data": { "id": 1, ... } }
```

Validation ไม่ผ่าน (400):

```json
{ "success": false, "message": "ข้อมูลไม่ถูกต้อง", "errors": { "email": "รูปแบบอีเมลไม่ถูกต้อง" } }
```

ผิดพลาดทั่วไป (404/500):

```json
{ "success": false, "message": "ไม่พบลูกค้าที่ระบุ" }
```

### ตัวอย่างเรียกด้วย curl

```bash
# เพิ่มลูกค้า
curl -X POST http://localhost:5000/api/customers \
  -H "Content-Type: application/json" \
  -d '{"customer_code":"C-2001","first_name":"สมชาย","last_name":"ใจดี",
       "phone":"081-234-5678","email":"somchai@example.com",
       "company":"บริษัท ทดสอบ จำกัด","status":"Lead"}'

# ค้นหา
curl "http://localhost:5000/api/customers/search?q=สมชาย"

# แก้ไข (ส่งเฉพาะฟิลด์ที่เปลี่ยน)
curl -X PUT http://localhost:5000/api/customers/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"เสนอราคา"}'

# ลบ
curl -X DELETE http://localhost:5000/api/customers/1
```

## มาตรการความปลอดภัย

- **Prepared Statements ทุกจุด**: ค่าจากผู้ใช้ถูกส่งเป็น parameter (`?`) เสมอ — ไม่มี string
  concatenation ใน SQL จึงป้องกัน SQL Injection (ชื่อคอลัมน์มาจาก whitelist เท่านั้น)
- **Validation ก่อนบันทึก**: ตรวจรูปแบบ/ความยาว/ค่าที่อนุญาตก่อนถึง database
- **ไม่เปิดเผยรายละเอียด DB**: error จาก MySQL ถูกแปลงเป็นข้อความไทยทั่วไป
  รายละเอียดเต็ม (SQL, error code) บันทึกเฉพาะ log ฝั่งเซิร์ฟเวอร์
- **ข้อมูลลับจาก `.env` เท่านั้น**: ไม่มีรหัสผ่าน hard-code ในโค้ด และ `.env` ไม่ถูก commit
- **CORS**: จำกัดแหล่งที่เรียก API ได้ด้วย `CLIENT_ORIGIN` ใน `.env`
- **จำกัดขนาด body**: `express.json({ limit: "100kb" })` กัน payload ขนาดเกินจำเป็น
