// แก้ password_hash ที่ถูกกรอกเป็นข้อความเปล่า (เช่น ตั้งรหัสผ่านใน phpMyAdmin ตรง ๆ)
// ให้กลับเป็นรูปแบบ scrypt `s1$salt$hash` ตามที่ server.js verifyPassword ต้องการ
// 使い方: node tools/fix-plaintext-password.js            (ตรวจสอบอย่างเดียว)
//         node tools/fix-plaintext-password.js --apply     (แก้จริง)
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const { promisify } = require("util");
const mysql = require("mysql2/promise");

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 64);
  return `s1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function isValidHash(stored) {
  const parts = String(stored || "").split("$");
  return parts.length === 3 && parts[0] === "s1" && parts[1].length === 32 && parts[2].length === 128;
}

(async () => {
  const apply = process.argv.includes("--apply");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "0" ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "1" },
    connectTimeout: 15000,
  });

  const [rows] = await conn.query("SELECT id, username, password_hash FROM cmr.users");
  const bad = rows.filter((r) => !isValidHash(r.password_hash));
  console.log(`ผู้ใช้ทั้งหมด ${rows.length} ราย, hash ผิดรูปแบบ ${bad.length} ราย`);
  for (const r of bad) {
    const plain = String(r.password_hash || "");
    console.log(`  - ${r.username}: เปลี่ยนข้อความเปล่า (${plain.length} ตัวอักษร) -> scrypt hash`);
    if (apply) {
      const hashed = await hashPassword(plain);
      await conn.query("UPDATE cmr.users SET password_hash = ? WHERE id = ?", [hashed, r.id]);
    }
  }
  if (bad.length && !apply) {
    console.log("\n(ยังไม่แก้ — รันซ้ำพร้อม --apply เพื่อบันทึกจริง)");
  } else if (!bad.length) {
    console.log("ไม่มีอะไรต้องแก้");
  } else {
    // ตรวจกลับว่ารหัสผ่านเดิม (ข้อความเปล่าที่กรอกไว้) ยัง login ได้จริงหลังแปลง hash
    console.log("\nตรวจรหัสผ่านหลังแก้:");
    const [after] = await conn.query("SELECT username, password_hash FROM cmr.users");
    for (const b of bad) {
      const row = after.find((x) => x.username === b.username);
      if (!row || row.password_hash === b.password_hash) {
        console.log(`  - ${b.username}: ยังไม่ถูกเปลี่ยน!`);
        continue;
      }
      const parts = row.password_hash.split("$");
      const expected = Buffer.from(parts[2], "hex");
      const derived = await scryptAsync(String(b.password_hash), Buffer.from(parts[1], "hex"), expected.length);
      const match = crypto.timingSafeEqual(derived, expected);
      console.log(`  - ${b.username}: ${match ? "ใช้รหัสผ่านเดิม login ได้ ✓" : "ตรวจไม่ผ่าน ✗"}`);
    }
  }
  await conn.end();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
