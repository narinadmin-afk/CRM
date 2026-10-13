/* ============================================================
   sql/init.js — สร้างฐานข้อมูล/ตารางด้วยคำสั่ง npm run db:init
   (อ่าน schema.sql มารันผ่าน connection เดียว — ไม่ต้องมี mysql client)
   ============================================================ */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

(async () => {
  const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_PORT"];
  const missing = required.filter((k) => process.env[k] === undefined);
  if (missing.length) {
    console.error("ขาด env: " + missing.join(", ") + " — คัดลอก .env.example เป็น .env ก่อน");
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8")
    .replace(/`crm_customers`/g, "`" + process.env.DB_NAME + "`"); // ใช้ชื่อ DB จาก .env

  /* multipleStatements: เปิดเฉพาะคำสั่ง init นี้ (ไม่ใช่จุดรับข้อมูลจากผู้ใช้) */
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 3306,
    multipleStatements: true,
    charset: "utf8mb4"
  });

  try {
    await conn.query(sql);
    console.log(`สร้างฐานข้อมูล "${process.env.DB_NAME}" และตาราง customers เรียบร้อย`);
  } catch (err) {
    console.error("สร้างฐานข้อมูลไม่สำเร็จ:", err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
})();
