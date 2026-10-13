/* ============================================================
   config/db.js — การเชื่อมต่อฐานข้อมูล MySQL
   - อ่านค่าจาก Environment Variables (.env) เท่านั้น:
     DB_HOST / DB_USER / DB_PASSWORD / DB_NAME / DB_PORT
   - ใช้ Connection Pool ของ mysql2 (โควตาเชื่อมต่อซ้ำใช้ได้)
   - ไม่มีการต่อ SQL ด้วย string รวมค่าจากผู้ใช้ — ทุก query ใน model
     ใช้ Prepared Statements (? placeholder) เท่านั้น
   ============================================================ */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

/* ---------- ตรวจว่าครบทุก env ก่อนเริ่มงาน ---------- */
const REQUIRED = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_PORT"];
const missing = REQUIRED.filter((k) => process.env[k] === undefined);
if (missing.length) {
  console.error("[db] ขาด Environment Variables: " + missing.join(", "));
  console.error('[db] วิธีตั้งค่า: คัดลอก .env.example เป็น .env แล้วเติมค่าให้ครบ');
  process.exit(1);
}

/* ---------- Connection Pool ---------- */
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  timezone: "local",
  /* เปิด multipleStatements = เสี่ยง SQL injection จึงปิดไว้ (มีเฉพาะใน sql/init.js ชั่วคราว) */
  multipleStatements: false
});

/** ทดสอบการเชื่อมต่อ — คืน true/false (ข้อความเต็มบันทึกเฉพาะฝั่ง server เท่านั้น) */
async function testConnection() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    console.error(
      "[db] เชื่อมต่อ MySQL ไม่สำเร็จ: " + (err.code || err.message),
      "\n      ตรวจ: " + dbInfo().user + "@" + dbInfo().host + ":" + dbInfo().port + "/" + dbInfo().name,
      "\n      (ไฟล์ .env, บริการ MySQL รันอยู่, ชื่อฐานข้อมูลถูกสร้างแล้วหรือยัง — รัน npm run db:init)"
    );
    return false;
  }
}

/** ข้อมูลสำหรับแสดงผล/log — ไม่รวมรหัสผ่าน */
function dbInfo() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME,
    user: process.env.DB_USER
  };
}

module.exports = { pool, testConnection, dbInfo };
