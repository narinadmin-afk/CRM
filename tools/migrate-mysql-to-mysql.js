/* ============================================================
   migrate-mysql-to-mysql.js — ย้ายข้อมูล MySQL → MySQL
   ใช้ตอนย้ายจาก MySQL ท้องถิ่นขึ้น DB ภายนอก (เช่น TiDB Cloud)

   ฝั่ง source (ค่าเริ่มต้น = MySQL ท้องถิ่น cmr):
     SRC_DB_HOST=127.0.0.1 SRC_DB_PORT=3306 SRC_DB_USER=root
     SRC_DB_PASSWORD=... SRC_DB_NAME=cmr
   ฝั่ง target: อ่านจาก .env (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD)
     ชื่อฐาน target = DB_NAME || cmr  (สร้าง schema ให้อัตโนมัติ)

   ตารางที่ย้าย: meta, records, users, sessions
   ความปลอดภัย: ถ้า target มีข้อมูลอยู่แล้วจะปฏิเสธ
     — ใช้ --force เพื่อล้างตาราง target ก่อนย้าย (แทนที่ของเดิม)

   รัน:  SRC_DB_PASSWORD=xxx node tools/migrate-mysql-to-mysql.js [--force]
   ============================================================ */
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const FORCE = process.argv.includes("--force");
const TABLES = ["meta", "records", "users", "sessions"];
const SRC = {
  host: process.env.SRC_DB_HOST || "127.0.0.1",
  port: Number(process.env.SRC_DB_PORT) || 3306,
  user: process.env.SRC_DB_USER || "root",
  password: process.env.SRC_DB_PASSWORD || "",
  database: process.env.SRC_DB_NAME || "cmr",
  charset: "utf8mb4"
};
const TGT_NAME = process.env.CMR_DB_NAME || process.env.DB_NAME || "cmr";
/* SSL ตรงกับ server.js: เปิดอัตโนมัติเมื่อ target อยู่ภายนอก (TiDB/Aiven บังคับ TLS) */
const SSL_WANTED = process.env.DB_SSL !== undefined
  ? !/^(0|false|off|disable|disabled)$/i.test(process.env.DB_SSL)
  : !!(process.env.DB_HOST && !/^(localhost|127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(process.env.DB_HOST));
const DB_SSL = SSL_WANTED
  ? {
      rejectUnauthorized: !/^(0|false|off|no)$/i.test(process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "1"),
      ...(process.env.DB_SSL_CA ? { ca: fs.readFileSync(process.env.DB_SSL_CA, "utf8") } : {})
    }
  : undefined;
const TGT = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  charset: "utf8mb4",
  ssl: DB_SSL
};

const count = async (conn, table) => {
  const [[{ c }]] = await conn.query("SELECT COUNT(*) AS c FROM `" + table + "`");
  return Number(c);
};

(async () => {
  console.log("SOURCE :", SRC.host + ":" + SRC.port + "/" + SRC.database + "  (user=" + SRC.user + ")");
  console.log("TARGET :", TGT.host + ":" + TGT.port + "/" + TGT_NAME + "  (user=" + TGT.user + ")");

  const src = await mysql.createConnection(SRC);

  /* 1) เตรียม target: สร้าง database + ตารางจาก schema ของโปรเจกต์ (idempotent) */
  const tgt = await mysql.createConnection({ ...TGT, multipleStatements: true });
  const ddl = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.mysql.sql"), "utf8")
    .replace(/`cmr`/g, "`" + TGT_NAME + "`");
  await tgt.query(ddl);
  await tgt.changeUser({ database: TGT_NAME });
  console.log("[1/4] สร้าง schema ของ target แล้ว (ถ้ายังไม่มี)");

  /* 2) ถ้า target มีข้อมูลอยู่แล้ว ปฏิเสธ เว้นแต่สั่ง --force */
  const existing = [];
  for (const t of TABLES) if (await count(tgt, t) > 0) existing.push(t);
  if (existing.length) {
    if (!FORCE) {
      console.error("  ✗ target มีข้อมูลอยู่แล้วในตาราง: " + existing.join(", "));
      console.error("    ย้ายทับไม่ได้ — ถ้าต้องการแทนที่ให้รันใหม่พร้อม --force");
      process.exit(1);
    }
    for (const t of TABLES) await tgt.query("TRUNCATE TABLE `" + t + "`");
    console.log("[2/4] --force: ล้างตาราง target (" + existing.join(", ") + ") แล้ว");
  } else {
    console.log("[2/4] target ว่าง — พร้อมรับข้อมูล");
  }

  /* 3) คัดลอกทีละตาราง (ยึดชื่อคอลัมน์จาก source) */
  console.log("[3/4] กำลังย้ายข้อมูล …");
  for (const t of TABLES) {
    const [cols] = await src.query("SHOW COLUMNS FROM `" + t + "`");
    const names = cols.map((c) => "`" + c.Field + "`");
    const [rows] = await src.query("SELECT " + names.join(", ") + " FROM `" + t + "`");
    if (!rows.length) { console.log("   - " + t + ": 0 แถว (ข้าม)"); continue; }
    const tuple = "(" + names.map(() => "?").join(", ") + ")";
    const values = rows.flatMap((r) => cols.map((c) => r[c.Field]));
    await tgt.query(
      "INSERT INTO `" + t + "` (" + names.join(", ") + ") VALUES " + rows.map(() => tuple).join(", "),
      values
    );
    console.log("   - " + t + ": " + rows.length + " แถว ✓");
  }

  /* 4) ตรวจสอบ: นับทั้งสองฝั่ง + ตัวอย่างข้อมูล */
  console.log("[4/4] ตรวจสอบ:");
  let ok = true;
  for (const t of TABLES) {
    const s = await count(src, t), g = await count(tgt, t);
    console.log("   " + t.padEnd(9) + " source=" + String(s).padStart(4) + "  target=" + String(g).padStart(4) + (s === g ? "  ✓" : "  ✗ ไม่ตรง!"));
    if (s !== g) ok = false;
  }
  const [sample] = await tgt.query("SELECT `values_json` FROM `records` ORDER BY `created_at` LIMIT 1");
  if (sample.length) console.log("   ตัวอย่างระเบียนแรก: " + String(sample[0].values_json).slice(0, 90) + " …");
  const [users] = await tgt.query("SELECT `username`, `role`, `active` FROM `users`");
  console.log("   ผู้ใช้: " + users.map((u) => u.username + "(" + u.role + (u.active ? "" : ",ระงับ") + ")").join(", "));

  await src.end(); await tgt.end();
  console.log(ok ? "\nย้ายข้อมูลสำเร็จ — ข้อมูลครบทุกตาราง" : "\nมีบางตารางไม่ตรง — ตรวจด้วยตนเอง");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("ย้ายข้อมูลไม่สำเร็จ:", e.message);
  process.exit(1);
});
