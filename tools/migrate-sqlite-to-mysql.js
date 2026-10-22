/* ============================================================
   tools/migrate-sqlite-to-mysql.js — ย้ายข้อมูลจาก SQLite (data/cmr.sqlite)
   ไป MySQL (ฐานข้อมูล `cmr` ตาม sql/schema.mysql.sql)

   ทำ 2 อย่าง:
     1) สร้างฐานข้อมูล/ตารางจาก sql/schema.mysql.sql (ถ้ายังไม่มี)
     2) คัดลอกข้อมูล meta / records / users / sessions ที่ยังไม่หมดอายุ

   รัน:  node tools/migrate-sqlite-to-mysql.js
   อ่านค่า MySQL จาก .env (DB_HOST/DB_USER/DB_PASSWORD/DB_PORT)
   ============================================================ */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const SQLITE_FILE = path.join(ROOT, "data", "cmr.sqlite");
const DB_NAME = "cmr";

const cfg = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: Number(process.env.DB_PORT) || 3306
};

(async () => {
  if (!fs.existsSync(SQLITE_FILE)) {
    console.error("ไม่พบไฟล์ SQLite:", SQLITE_FILE);
    process.exit(1);
  }

  /* 1) สร้าง schema ใน MySQL (ใช้ไฟล์เดียวกับที่ import ใน phpMyAdmin) */
  const ddl = fs.readFileSync(path.join(ROOT, "sql", "schema.mysql.sql"), "utf8")
    .replace(/`cmr`/g, "`" + DB_NAME + "`");
  const boot = await mysql.createConnection({ ...cfg, multipleStatements: true, charset: "utf8mb4" });
  await boot.query(ddl);
  await boot.end();
  console.log("✓ สร้างฐานข้อมูล/ตาราง \"" + DB_NAME + "\" แล้ว");

  const pool = mysql.createPool({ ...cfg, database: DB_NAME, charset: "utf8mb4", connectionLimit: 4 });

  /* 2) อ่านข้อมูลเดิมจาก SQLite */
  const sqlite = new DatabaseSync(SQLITE_FILE); // เปิดแบบปกติเพื่อให้อ่านข้อมูลใน WAL ได้ด้วย
  const meta = sqlite.prepare("SELECT key, value FROM meta").all();
  const records = sqlite.prepare("SELECT * FROM records ORDER BY created_at").all();
  const users = sqlite.prepare("SELECT * FROM users ORDER BY created_at").all();
  const sessions = sqlite.prepare("SELECT * FROM sessions WHERE expires_at > ?").all(Date.now());
  sqlite.close();

  const clear = process.argv.includes("--overwrite");
  if (clear) {
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM records");
    await pool.query("DELETE FROM users");
    await pool.query("DELETE FROM meta");
    console.log("• ล้างข้อมูลเดิมใน MySQL ก่อน (โหมด --overwrite)");
  }

  /* 3) ใส่ลง MySQL (ข้ามรายการที่ id ซ้ำอยู่แล้ว) */
  let n = 0;
  for (const r of meta) {
    await pool.query("INSERT INTO meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [r.key, r.value]);
    n++;
  }
  console.log("✓ meta:", n, "รายการ");

  n = 0;
  for (const r of users) {
    const [res] = await pool.query(
      "INSERT INTO users (id, username, display_name, email, password_hash, role, active, created_at) VALUES (?,?,?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), email = VALUES(email), password_hash = VALUES(password_hash), role = VALUES(role), active = VALUES(active)",
      [r.id, r.username, r.display_name, r.email || "", r.password_hash, r.role, r.active ? 1 : 0, Number(r.created_at)]
    );
    n++;
  }
  console.log("✓ users:", n, "บัญชี");

  n = 0;
  for (const r of records) {
    await pool.query(
      "INSERT INTO records (id, values_json, activities_json, created_at, updated_at, creator_id, creator_name) VALUES (?,?,?,?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE values_json = VALUES(values_json), activities_json = VALUES(activities_json), updated_at = VALUES(updated_at), creator_name = VALUES(creator_name)",
      [r.id, r.values_json, r.activities_json, Number(r.created_at), Number(r.updated_at), r.creator_id || null, r.creator_name || null]
    );
    n++;
  }
  console.log("✓ records:", n, "ระเบียน");

  n = 0;
  for (const s of sessions) {
    await pool.query(
      "INSERT IGNORE INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
      [s.token, s.user_id, Number(s.created_at), Number(s.expires_at)]
    );
    n++;
  }
  console.log("✓ sessions:", n, "รายการ (ที่ยังไม่หมดอายุ)");

  const [[cnt]] = await pool.query("SELECT (SELECT COUNT(*) FROM records) records, (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM meta) meta");
  console.log(`\nย้ายข้อมูลเสร็จ → MySQL ${DB_NAME}: ${cnt.records} ระเบียน · ${cnt.users} ผู้ใช้ · ${cnt.meta} meta`);
  console.log("ไฟล์ SQLite เดิมถูกเก็บไว้ที่ data/cmr.sqlite (ไม่ถูกลบ)");
  await pool.end();
})().catch((e) => { console.error("ย้ายข้อมูลไม่สำเร็จ:", e.message); process.exit(1); });
