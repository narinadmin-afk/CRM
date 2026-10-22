/* ตรวจว่า sql/schema.mysql.sql รันบน MySQL จริงได้ (ใช้ mysql-memory-server) */
import { createDB } from "mysql-memory-server";
import sql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.join(here, "..", "..", "sql", "schema.mysql.sql");
const script = fs.readFileSync(schemaFile, "utf8");

const db = await createDB();
let exitCode = 0;
try {
  const conn = await sql.createConnection({
    host: "127.0.0.1",
    user: db.username,
    port: db.port,
    password: "",
    multipleStatements: true,
  });

  await conn.query(script);
  await conn.query(script); // รันซ้ำอีกครั้งเพื่อตรวจ idempotency (IF NOT EXISTS)
  console.log("RUN_TWICE: OK");

  const [tables] = await conn.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'cmr' ORDER BY table_name"
  );
  console.log("TABLES:", JSON.stringify(tables.map((t) => t.table_name || t.TABLE_NAME)));

  for (const t of ["meta", "records", "users", "sessions"]) {
    const [cols] = await conn.query("SHOW COLUMNS FROM `" + t + "`");
    console.log(`-- ${t} (${cols.length})`);
    for (const c of cols) {
      console.log("   ", c.Field, "|", c.Type, "| null:", c.Null, "| key:", c.Key, "| def:", c.Default);
    }
  }

  // ลอง INSERT/SELECT ข้อมูลจริง (ค่า epoch ms, JSON, ภาษาไทย)
  const now = Date.now();
  await conn.query(
    "INSERT INTO meta (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    ["schema", JSON.stringify({ fields: [{ key: "owner", label: "ผู้รับผิดชอบ" }] })]
  );
  await conn.query(
    "INSERT INTO records (id, values_json, activities_json, created_at, updated_at, creator_id, creator_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["rec_test1", JSON.stringify({ status: " Lead", owner: "Admin CRM", note: "ทดสอบ ภาษาไทย" }), "[]", now, now, null, "Admin CRM"]
  );
  await conn.query(
    "INSERT INTO users (id, username, display_name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["usr_1", "admin", "Admin CRM", "", "s1$aa$bb", "admin", 1, now]
  );
  await conn.query("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ["t".repeat(64), "usr_1", now, now + 7 * 86400000]);

  const [[metaRow]] = await conn.query("SELECT `value` FROM meta WHERE `key`=?", ["schema"]);
  const [[rec]] = await conn.query("SELECT * FROM records WHERE id=?", ["rec_test1"]);
  console.log("META value round-trip:", metaRow.value);
  console.log("RECORD owner:", JSON.parse(rec.values_json).owner, "| created_at type:", typeof rec.created_at, "| creator_name:", rec.creator_name);

  // ตรวจ UNIQUE / NOT NULL
  try {
    await conn.query("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
      ["usr_2", "admin", "x", "h", now]);
    console.log("UNIQUE username: FAIL (INSERT ซ้ำสำเร็จ)");
    exitCode = 1;
  } catch (e) {
    console.log("UNIQUE username: OK ->", e.code || e.message);
  }

  const [idx] = await conn.query(
    "SELECT table_name t, index_name n, column_name c FROM information_schema.statistics WHERE table_schema='cmr' ORDER BY table_name, index_name, seq_in_index"
  );
  console.log("INDEXES:", JSON.stringify(idx.map((i) => `${i.t}.${i.n}:${i.c}`)));

  await conn.end();
} catch (e) {
  console.error("SCHEMA_ERROR:", e.sqlMessage || e.message || e);
  exitCode = 1;
} finally {
  await db.stop();
}
process.exit(exitCode);
