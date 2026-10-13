/**
 * เปลี่ยนชื่อที่ปรากฏในข้อมูลระเบียน/schema (owner, activity author, creator_name, ตัวเลือกฟิลด์)
 * โดยไม่แตะตาราง users และไม่ขยับ updated_at ของระเบียน
 *
 * รัน:  node tools/rename-name.js "<ชื่อเดิม>" "<ชื่อใหม่>"
 */
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const [, , FROM, TO] = process.argv;
if (!FROM || !TO) {
  console.error('ใช้: node tools/rename-name.js "<ชื่อเดิม>" "<ชื่อใหม่>"');
  process.exit(2);
}

const ROOT = path.join(__dirname, "..");
const DB_FILE = process.env.CMR_DB_FILE
  ? path.resolve(ROOT, process.env.CMR_DB_FILE)
  : path.join(ROOT, "data", "cmr.sqlite");

if (!fs.existsSync(DB_FILE)) {
  console.error("ไม่พบฐานข้อมูล:", DB_FILE);
  process.exit(1);
}

const db = new DatabaseSync(DB_FILE);
const count = (s) => (String(s).match(new RegExp(FROM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

/* 1) สำรองแบบ consistent */
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
const backup = `${DB_FILE}-backup-${stamp}`;
db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
console.log("สำรองฐานข้อมูลแล้ว:", path.relative(ROOT, backup));

/* 2) ตรวจก่อนแก้ */
const before = {
  values: db.prepare("SELECT COUNT(*) c FROM records WHERE values_json LIKE ?").get(`%${FROM}%`).c,
  activities: db.prepare("SELECT COUNT(*) c FROM records WHERE activities_json LIKE ?").get(`%${FROM}%`).c,
  creator_name: db.prepare("SELECT COUNT(*) c FROM records WHERE creator_name = ?").get(FROM).c,
  schema: db.prepare("SELECT COUNT(*) c FROM meta WHERE key='schema' AND value LIKE ?").get(`%${FROM}%`).c,
  users: db.prepare("SELECT COUNT(*) c FROM users WHERE display_name = ?").get(FROM).c
};
console.log("ก่อนแก้ (แถวที่มีชื่อนี้):", JSON.stringify(before));
if (before.users > 0) {
  console.log("หมายเหตุ: มีบัญชีผู้ใช้", before.users, "บัญชีที่ชื่อนี้ — script นี้จะไม่แตะตาราง users");
}
if (before.values + before.activities + before.creator_name + before.schema === 0) {
  console.log("ไม่พบชื่อนี้ในข้อมูลใดเลย — ไม่มีอะไรต้องแก้");
  db.close();
  process.exit(0);
}

/* 3) แทนที่แบบ exact string ทุกจุดที่เจอ (ไม่แตะตาราง users) */
let changed = 0;
db.exec("BEGIN");
try {
  for (const row of db.prepare("SELECT id, values_json, activities_json, creator_name FROM records").all()) {
    const v = row.values_json.replaceAll(FROM, TO);
    const a = row.activities_json.replaceAll(FROM, TO);
    const c = row.creator_name == null ? null : String(row.creator_name).replaceAll(FROM, TO);
    if (v !== row.values_json || a !== row.activities_json || c !== row.creator_name) {
      db.prepare("UPDATE records SET values_json = ?, activities_json = ?, creator_name = ? WHERE id = ?")
        .run(v, a, c, row.id);
      changed++;
    }
  }
  const meta = db.prepare("SELECT value FROM meta WHERE key='schema'").get();
  const newMeta = meta.value.replaceAll(FROM, TO);
  if (newMeta !== meta.value) {
    db.prepare("UPDATE meta SET value = ? WHERE key='schema'").run(newMeta);
    changed++;
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("ล้มเหลว ยกเลิกการแก้ไข:", e.message);
  process.exit(1);
}

/* 4) ตรวจหลังแก้ */
const after = {
  values: db.prepare("SELECT COUNT(*) c FROM records WHERE values_json LIKE ?").get(`%${FROM}%`).c,
  activities: db.prepare("SELECT COUNT(*) c FROM records WHERE activities_json LIKE ?").get(`%${FROM}%`).c,
  creator_name: db.prepare("SELECT COUNT(*) c FROM records WHERE creator_name = ?").get(FROM).c,
  schema: db.prepare("SELECT COUNT(*) c FROM meta WHERE key='schema' AND value LIKE ?").get(`%${FROM}%`).c
};
console.log("แก้แล้ว", changed, "แถว/รายการ");
console.log("หลังแก้ (ยังเหลือชื่อเดิม):", JSON.stringify(after));
console.log(
  "เจ้าของคนใหม่:",
  JSON.stringify(db.prepare("SELECT json_extract(values_json,'$.owner') o, COUNT(*) c FROM records GROUP BY o").all(), null, 1)
);
const ownerOpts = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='schema'").get().value)
  .fields.find((f) => f.key === "owner").options;
console.log("ตัวเลือก owner ใน schema:", JSON.stringify(ownerOpts));
db.close();

const ok = Object.values(after).every((n) => n === 0) && ownerOpts.includes(TO) && !ownerOpts.includes(FROM);
console.log(ok ? "เปลี่ยนชื่อสำเร็จ" : "ยังไม่ผ่าน");
process.exit(ok ? 0 : 1);
