/**
 * ซ่อม meta.schema ใน data/cmr.sqlite
 * สาเหตุ: แถว schema ถูกเขียนด้วยข้อความที่ Thai ถูกแทนที่ด้วย "?" (ASCII-lossy)
 * วิธีแก้: สำรอง DB แล้วคืนค่าจาก shared/seed.js (ตรวจแล้ว key/type ตรงกันทั้งหมด)
 *
 * รัน:  node tools/repair-schema.js
 */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const Seed = require("../shared/seed.js");

const ROOT = path.join(__dirname, "..");
const DB_FILE = process.env.CMR_DB_FILE
  ? path.resolve(ROOT, process.env.CMR_DB_FILE)
  : path.join(ROOT, "data", "cmr.sqlite");

if (!fs.existsSync(DB_FILE)) {
  console.error("ไม่พบฐานข้อมูล:", DB_FILE);
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);

/* 1) สำรองแบบ consistent (VACUUM INTO = snapshot ที่รวม WAL แล้ว) */
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
const backup = `${DB_FILE}.backup-${stamp}`;
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log("สำรองฐานข้อมูลแล้ว:", path.relative(ROOT, backup));

/* 2) อ่านค่าปัจจุบัน */
const before = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get();
const beforeRaw = before ? before.value : null;
const q = (s) => (s.match(/\?/g) || []).length;
console.log("ก่อนแก้: ? ทั้งหมด =", beforeRaw ? q(beforeRaw) : "(ไม่มีแถว)");

/* 3) คืนค่าจาก seed */
const next = JSON.stringify(Seed.DEFAULT_SCHEMA);
db.prepare(
  `INSERT INTO meta (key, value) VALUES ('schema', ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
).run(next);

/* 4) ตรวจซ้ำ */
const after = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get().value;
const afterSch = JSON.parse(after);
console.log("หลังแก้: ? ทั้งหมด =", q(after), "(ควรเป็น 0)");
console.log("name:", afterSch.name);
console.log("labels:", JSON.stringify(afterSch.fields.map((f) => f.label)));

const okKeys =
  JSON.stringify(afterSch.fields.map((f) => f.key)) ===
  JSON.stringify(Seed.DEFAULT_SCHEMA.fields.map((f) => f.key));
console.log("key ตรงกับ seed:", okKeys);

db.close();
if (q(after) !== 0 || !okKeys) {
  console.error("ยังไม่ผ่าน");
  process.exit(1);
}
console.log("ซ่อมเสร็จแล้ว");
