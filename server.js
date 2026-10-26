/* ============================================================
   CMR Base — เซิร์ฟเวอร์ (Node.js)
   - เสิร์ฟไฟล์หน้าเว็บ (static)
   - REST API เก็บข้อมูลลง MySQL ผ่าน mysql2 (ค่าเชื่อมต่ออ่านจาก .env)
   - ระบบผู้ใช้: Register / Login / Logout (session cookie + scrypt)
   - สิทธิ์: admin | member | viewer บังคับทุก endpoint ฝั่์เซิร์ฟเวอร์
   รัน:  node server.js   หรือ   npm start
   ============================================================ */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const mysql = require("mysql2/promise");
const Seed = require("./shared/seed.js");
const Quo = require("./shared/quotation.js");
require("dotenv").config({ quiet: true });

const scryptAsync = promisify(crypto.scrypt);

/* หมายเหตุ: ถ้า env PORT ไม่ได้ตั้งค่า (หรือไม่ใช่พอร์ตที่ใช้ได้) ให้ใช้ 3000 */
const envPort = Number(process.env.PORT);
const PORT = Number.isInteger(envPort) && envPort > 0 ? envPort : 3000;
const ROOT = __dirname;
/* ---- การเชื่อมต่อ MySQL ----
   อ่านค่าจาก .env ได้ 2 แบบ (ค่าแยกต่างหาก DB_HOST/DB_USER/... สำคัญกว่า):
     1) DB_HOST / DB_USER / DB_PASSWORD / DB_NAME / DB_PORT
     2) DATABASE_URL  — รูปแบบ mysql://user:pass@host:3306/dbname
        ใช้ตอน deploy บน platform อย่าง Render / Railway ที่ให้ URL มาทั้งก้อน
   SSL: เปิดอัตโนมัติเมื่อ host ไม่ใช่ localhost (Render บังคับ SSL)
     - DB_SSL=1 หรือ 0        บังคับเปิด/ปิด เอง
     - DB_SSL=…?sslmode=…      ใน DATABASE_URL ก็ใช้ได้ (disable = ปิด)
     - DB_SSL_REJECT_UNAUTHORIZED=0  ใช้เมื่อ certificate ตรวจสอบไม่ผ่าน
     - DB_SSL_CA=path/to/ca.pem      ตรวจสอบ certificate ด้วย CA ของผู้ให้บริการ (เช่น Aiven)
*/
function parseDatabaseUrl(raw) {
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username || ""),
    password: decodeURIComponent(u.password || ""),
    database: decodeURIComponent((u.pathname || "").replace(/^\//, "")) || undefined,
    sslParam: u.searchParams.get("ssl") || u.searchParams.get("sslmode") || undefined
  };
}
const urlCfg = process.env.DATABASE_URL ? parseDatabaseUrl(process.env.DATABASE_URL) : {};
const isLocalHost = (h) => !h || h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "::ffff:127.0.0.1";
function resolveSsl() {
  const flag = process.env.DB_SSL ?? urlCfg.sslParam;
  const enabled = flag === undefined
    ? !isLocalHost(urlCfg.host || process.env.DB_HOST) // ค่าเฉลี่ย: remote → เปิด, localhost → ปิด
    : !/^(0|false|off|disable|disabled)$/i.test(String(flag).trim());
  if (!enabled) return undefined;
  const reject = process.env.DB_SSL_REJECT_UNAUTHORIZED;
  const ssl = { rejectUnauthorized: reject === undefined ? true : !/^(0|false|off|no)$/i.test(String(reject).trim()) };
  if (process.env.DB_SSL_CA) {
    try { ssl.ca = fs.readFileSync(process.env.DB_SSL_CA, "utf8"); }
    catch (e) {
      console.error("[cmr] อ่านไฟล์ CA จาก DB_SSL_CA ไม่ได้: " + process.env.DB_SSL_CA + " (" + e.message + ")");
      process.exit(1);
    }
  }
  return ssl;
}

/* CMR_DB_NAME ใช้ตอนทดสอบเพื่อไม่ให้แตะฐานข้อมูลจริง */
const DB_NAME = process.env.CMR_DB_NAME || process.env.DB_NAME || urlCfg.database || "cmr";
const DB = {
  host: process.env.DB_HOST || urlCfg.host || "localhost",
  user: process.env.DB_USER || urlCfg.user || "root",
  password: process.env.DB_PASSWORD ?? urlCfg.password ?? "",
  port: Number(process.env.DB_PORT) || urlCfg.port || 3306,
  ssl: resolveSsl()
};

const SESSION_COOKIE = "cmr_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 วัน
const ROLES = ["admin", "member", "viewer"];
const ROLE_LABELS = { admin: "ผู้ดูแลระบบ", member: "สมาชิก", viewer: "ผู้ชม" };

/* ---------------- database ---------------- */
const pool = mysql.createPool({
  ...DB,
  database: DB_NAME,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: false,
  /* กัน connection เก่าถูกตัดเงียบ (TiDB/serverless ปิด idle) — ECONNRESET ตอนเริ่ม query */
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
});

/** สร้างฐานข้อมูล/ตารางจาก sql/schema.mysql.sql (idempotent — รันได้ทุกครั้งตอนเริ่ม) */
async function ensureSchema() {
  const ddl = fs.readFileSync(path.join(ROOT, "sql", "schema.mysql.sql"), "utf8")
    .replace(/`cmr`/g, "`" + DB_NAME + "`");
  const conn = await mysql.createConnection({ ...DB, multipleStatements: true, charset: "utf8mb4" });
  try {
    await conn.query(ddl);
    /* migration: เพิ่มคอลัมน์ users.avatar ถ้ายังไม่มี (ตาราง CREATE IF NOT EXISTS ไม่เติมคอลัมน์ใหม่เอง) */
    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar'",
      [DB_NAME]
    );
    if (!cols.length) await conn.query("ALTER TABLE `users` ADD COLUMN `avatar` LONGTEXT NULL");
  } finally {
    await conn.end();
  }
}

/* ---------------- meta / schema ---------------- */
async function getMeta(key, fallback = null) {
  const [rows] = await pool.query("SELECT `value` FROM meta WHERE `key` = ?", [key]);
  if (!rows.length) return fallback;
  try { return JSON.parse(rows[0].value); } catch { return fallback; }
}
async function setMeta(key, value) {
  await pool.query(
    "INSERT INTO meta (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    [key, JSON.stringify(value)]
  );
}

/* ---------------- records ---------------- */
function rowToRecord(row) {
  return {
    id: row.id,
    values: JSON.parse(row.values_json),
    activities: JSON.parse(row.activities_json),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    creator_id: row.creator_id || null,
    creator_name: row.creator_name || null
  };
}

async function listRecords() {
  const [rows] = await pool.query("SELECT * FROM records ORDER BY updated_at DESC");
  return rows.map(rowToRecord);
}

async function getRecord(id) {
  const [rows] = await pool.query("SELECT * FROM records WHERE id = ?", [id]);
  return rows.length ? rowToRecord(rows[0]) : null;
}

async function insertRecord(rec) {
  await pool.query(
    "INSERT INTO records (id, values_json, activities_json, created_at, updated_at, creator_id, creator_name) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [rec.id, JSON.stringify(rec.values), JSON.stringify(rec.activities),
      rec.created_at, rec.updated_at, rec.creator_id || null, rec.creator_name || null]
  );
}

async function updateRecordRow(rec) {
  await pool.query(
    "UPDATE records SET values_json = ?, activities_json = ?, updated_at = ?, creator_id = ?, creator_name = ? WHERE id = ?",
    [JSON.stringify(rec.values), JSON.stringify(rec.activities), rec.updated_at,
      rec.creator_id || null, rec.creator_name || null, rec.id]
  );
}

function newId(prefix = "rec") {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fieldLabel(schema, key) {
  const f = (schema.fields || []).find((x) => x.key === key);
  return f ? f.label : key;
}

/* ---------------- users & password ---------------- */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, display_name: u.display_name,
    email: u.email, avatar: u.avatar || null, role: u.role,
    role_label: ROLE_LABELS[u.role] || u.role,
    active: !!u.active, created_at: Number(u.created_at)
  };
}

async function findUserByUsername(username) {
  const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [String(username || "").trim().toLowerCase()]);
  return rows[0];
}
async function findUserById(id) {
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0];
}
async function countUsers() {
  const [[r]] = await pool.query("SELECT COUNT(*) AS c FROM users");
  return Number(r.c);
}
async function countActiveAdmins() {
  const [[r]] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1");
  return Number(r.c);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 64);
  return `s1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 3 || parts[0] !== "s1") return false;
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const derived = await scryptAsync(String(password), salt, expected.length);
    return crypto.timingSafeEqual(derived, expected);
  } catch { return false; }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function bearerOrCookie(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return parseCookies(req)[SESSION_COOKIE] || null;
}

/** คืนข้อมูลผู้ใช้จาก session (และลบ session ถ้ายังไม่หมดอายุ) */
async function userFromRequest(req) {
  const token = bearerOrCookie(req);
  if (!token) return null;
  const [rows] = await pool.query("SELECT * FROM sessions WHERE token = ?", [token]);
  const s = rows[0];
  if (!s) return null;
  if (Number(s.expires_at) < Date.now()) {
    await pool.query("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }
  const u = await findUserById(s.user_id);
  if (!u || !u.active) return null;
  return u;
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await pool.query("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [token, userId, now, now + SESSION_TTL_MS]);
  appendCookie(res, SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "Lax", path: "/", maxAge: SESSION_TTL_MS / 1000
  });
  return token;
}

async function destroySession(req, res) {
  const token = bearerOrCookie(req);
  if (token) await pool.query("DELETE FROM sessions WHERE token = ?", [token]);
  appendCookie(res, SESSION_COOKIE, "", { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 0 });
}

function appendCookie(res, name, value, opts = {}) {
  const prev = res.getHeader("Set-Cookie");
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge !== undefined) cookie += `; Max-Age=${Math.floor(opts.maxAge)}`;
  if (opts.path) cookie += `; Path=${opts.path}`;
  if (opts.httpOnly) cookie += "; HttpOnly";
  if (opts.sameSite) cookie += `; SameSite=${opts.sameSite}`;
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
  list.push(cookie);
  res.setHeader("Set-Cookie", list);
}

/* ---------------- สิทธิ์ ---------------- */
const isAdmin = (u) => !!u && u.role === "admin";
const canWrite = (u) => !!u && u.role !== "viewer";

/** member แก้ไขได้เฉพาะระเบียนที่ตัวเองสร้าง หรือที่ตัวเองเป็น "ผู้รับผิดชอบ" */
function canEditRecord(u, rec) {
  if (!u) return false;
  if (isAdmin(u)) return true;
  if (!canWrite(u)) return false;
  if (rec.creator_id && rec.creator_id === u.id) return true;
  return (rec.values && rec.values.owner) === u.display_name;
}
/** ลบได้เฉพาะ admin หรือคนที่สร้างระเบียนนั้นเอง */
function canDeleteRecord(u, rec) {
  if (!u) return false;
  if (isAdmin(u)) return true;
  return canWrite(u) && !!rec.creator_id && rec.creator_id === u.id;
}

/* ============================================================
   ใบเสนอราคา (Quotations) + คลังสินค้า (Products)
   ============================================================ */
function rowToQuotation(row) {
  const num = (v) => (v === null || v === undefined ? 0 : Number(v));
  return {
    id: row.id,
    quotation_number: row.quotation_number,
    customer_id: row.customer_id || null,
    customer_name: row.customer_name,
    customer_address: row.customer_address || "",
    customer_tax_id: row.customer_tax_id || "",
    contact_name: row.contact_name || "",
    contact_email: row.contact_email || "",
    contact_phone: row.contact_phone || "",
    issue_date: row.issue_date,
    expiry_date: row.expiry_date || "",
    status: row.status,
    tax_mode: row.tax_mode,
    tax_rate: num(row.tax_rate),
    subtotal: num(row.subtotal),
    discount_type: row.discount_type || "",
    discount_value: row.discount_value === null || row.discount_value === undefined ? null : num(row.discount_value),
    discount_amount: num(row.discount_amount),
    taxable_amount: num(row.taxable_amount),
    tax_amount: num(row.tax_amount),
    grand_total: num(row.grand_total),
    currency: row.currency || "THB",
    payment_terms: row.payment_terms || "",
    notes: row.notes || "",
    owner: row.owner || "",
    prepared_by: row.prepared_by || "",
    created_by: row.created_by || null,
    created_by_name: row.created_by_name || "",
    approved_by: row.approved_by || null,
    approved_by_name: row.approved_by_name || "",
    approved_at: row.approved_at ? Number(row.approved_at) : null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    baht_text: Quo.bahtText(num(row.grand_total))
  };
}

function rowToProduct(row) {
  return {
    id: row.id,
    code: row.code || "",
    name: row.name,
    description: row.description || "",
    unit: row.unit || "หน่วย",
    unit_price: Number(row.unit_price),
    tax_rate: Number(row.tax_rate),
    active: !!row.active,
    creator_id: row.creator_id || null,
    creator_name: row.creator_name || "",
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at)
  };
}

async function getQuotation(id) {
  const [rows] = await pool.query("SELECT * FROM quotations WHERE id = ?", [id]);
  return rows.length ? rowToQuotation(rows[0]) : null;
}

async function getQuotationItems(qid) {
  const [rows] = await pool.query("SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order ASC, created_at ASC", [qid]);
  return rows.map((r) => ({
    id: r.id,
    product_id: r.product_id || null,
    product_code: r.product_code_snapshot || "",
    product_name: r.product_name_snapshot,
    description: r.description_snapshot || "",
    quantity: Number(r.quantity),
    unit: r.unit || "หน่วย",
    unit_price: Number(r.unit_price),
    discount_type: r.discount_type || "",
    discount_value: r.discount_value === null || r.discount_value === undefined ? null : Number(r.discount_value),
    tax_rate: Number(r.tax_rate),
    line_total: Number(r.line_total)
  }));
}

async function getQuotationLogs(qid) {
  const [rows] = await pool.query("SELECT * FROM quotation_activity_logs WHERE quotation_id = ? ORDER BY created_at DESC, id DESC", [qid]);
  return rows.map((r) => ({
    id: r.id, user_id: r.user_id || null, user_name: r.user_name || "",
    action: r.action, old_status: r.old_status || null, new_status: r.new_status || null,
    detail: r.detail || "", created_at: Number(r.created_at)
  }));
}

/** เติม activity log ใบเสนอราคา (เรียกด้วย pool หรือ connection ใน transaction ก็ได้) */
async function logQuotation(exec, qid, user, action, oldStatus, newStatus, detail) {
  await exec.query(
    "INSERT INTO quotation_activity_logs (id, quotation_id, user_id, user_name, action, old_status, new_status, detail, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [newId("ql"), qid, user ? user.id : null, user ? user.display_name : "ระบบ",
      action, oldStatus || null, newStatus || null, detail || null, Date.now()]
  );
}

/** บันทึกเหตุการณ์ใบเสนอราคาลง Activity Timeline ของระเบียนลูกค้า (ถ้ามี customer_id) */
async function appendCustomerActivity(customerId, text, author) {
  if (!customerId) return;
  try {
    const rec = await getRecord(customerId);
    if (!rec) return;
    const at = Date.now();
    rec.activities.push({ id: newId("a"), type: "update", text, author, at });
    rec.updated_at = at;
    await updateRecordRow(rec);
  } catch (e) {
    console.error("[cmr] เพิ่ม activity ลูกค้าไม่สำเร็จ:", e.message);
  }
}

/** เปลี่ยนเอกสารที่เลยวันหมดอายุ (และยังค้างสถานะส่ง/รอ) เป็น Expired อัตโนมัติ */
async function markExpiredQuotations() {
  const today = Quo.todayISO();
  await pool.query(
    "UPDATE quotations SET status = 'Expired' WHERE status IN ('Sent', 'Pending') AND expiry_date IS NOT NULL AND expiry_date <> '' AND expiry_date < ?",
    [today]
  );
}

/**
 * สร้างเลขที่เอกสารถัดไป QT-YYYY-NNNN แบบ atomic
 *  - ใช้ counter รายปีในตาราง meta: UPDATE … LAST_INSERT_ID(+1)
 *    คืนล็อกแถวจนจบ transaction → concurrent INSERT ต้องรอคิว ไม่ชนกัน
 *  - UNIQUE KEY ที่ quotation_number เป็นตาข่ายรองรับ และ retry เมื่อชน/ชนล็อก
 *  (ถ้า transaction ยกเลิก จะเกิดช่องเลขหายไปบ้าง — ปกติของ sequence)
 */
async function nextQuotationNumber(conn, year) {
  const key = `qt_seq_${year}`;
  await conn.query(
    "INSERT INTO meta (`key`, `value`) VALUES (?, '0') ON DUPLICATE KEY UPDATE `value` = `value`", [key]);
  await conn.query(
    "UPDATE meta SET `value` = LAST_INSERT_ID(CAST(`value` AS UNSIGNED) + 1) WHERE `key` = ?", [key]);
  const [rows] = await conn.query("SELECT LAST_INSERT_ID() AS n");
  const seq = Number(rows[0] && rows[0].n);
  return Quo.makeQuotationNumber(year, Number.isFinite(seq) && seq > 0 ? seq : 1);
}

/** ข้อผิดพลาดที่ควรลองใหม่ (เลขซ้ำ / deadlock / lock timeout / TiDB write conflict) */
function isRetryableNumberError(e) {
  if (!e) return false;
  const errno = Number(e.errno);
  if ([1062, 1213, 1205, 9004].includes(errno)) return true;
  const msg = String(e.message || e);
  return /duplicate|deadlock|lock wait|write conflict/i.test(msg);
}

/** member แก้ไขได้เฉพาะของตัวเอง/ที่ตัวเองรับผิดชอบ (ตรงกับกฎระเบียนลูกค้า) */
function canEditQuotation(u, q) {
  if (!u) return false;
  if (isAdmin(u)) return true;
  if (!canWrite(u)) return false;
  if (q.created_by && q.created_by === u.id) return true;
  return !!q.owner && q.owner === u.display_name;
}
/** ลบได้เฉพาะ admin หรือคนสร้าง — เอกสารอนุมัติแล้วลบได้เฉพาะ admin (รักษาประวัติ) */
function canDeleteQuotation(u, q) {
  if (!u) return false;
  if (isAdmin(u)) return true;
  return canWrite(u) && !!q.created_by && q.created_by === u.id && q.status !== Quo.STATUS.APPROVED;
}

/** สร้าง/คัดลอกใบเสนอราคาใน transaction (เลขซ้ำ → retry สูงสุด 5 ครั้ง) */
async function createQuotationTx({ doc, items, totals, user, sourceAction }) {
  const year = Number(String(doc.issue_date || Quo.todayISO()).slice(0, 4)) || new Date().getFullYear();
  const now = Date.now();
  let lastErr = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const number = await nextQuotationNumber(conn, year);
      const id = newId("qt");
      await conn.query(
        "INSERT INTO quotations (id, quotation_number, customer_id, customer_name, customer_address, customer_tax_id, " +
        "contact_name, contact_email, contact_phone, issue_date, expiry_date, status, tax_mode, tax_rate, " +
        "subtotal, discount_type, discount_value, discount_amount, taxable_amount, tax_amount, grand_total, currency, " +
        "payment_terms, notes, owner, prepared_by, created_by, created_by_name, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, number,
          doc.customer_id || null, doc.customer_name, doc.customer_address || null, doc.customer_tax_id || null,
          doc.contact_name || null, doc.contact_email || null, doc.contact_phone || null,
          doc.issue_date, doc.expiry_date || null,
          doc.tax_mode, totals.tax_rate,
          totals.subtotal, doc.discount_type || null, doc.discount_value === "" || doc.discount_value === undefined || doc.discount_value === null ? null : Number(doc.discount_value),
          totals.discount_amount, totals.taxable_amount, totals.tax_amount, totals.grand_total, doc.currency || "THB",
          doc.payment_terms || null, doc.notes || null,
          doc.owner || user.display_name, doc.prepared_by || user.display_name,
          user.id, user.display_name, now, now]
      );
      for (const [i, it] of items.entries()) {
        const c = Quo.calcLine(it);
        await conn.query(
          "INSERT INTO quotation_items (id, quotation_id, product_id, product_code_snapshot, product_name_snapshot, " +
          "description_snapshot, quantity, unit, unit_price, discount_type, discount_value, tax_rate, line_total, sort_order, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [newId("qi"), id, it.product_id || null, it.product_code || null, it.product_name,
            it.description || null, it.quantity, it.unit || "หน่วย", it.unit_price,
            it.discount_type || null, it.discount_value === "" || it.discount_value === undefined || it.discount_value === null ? null : Number(it.discount_value),
            it.tax_rate === undefined || it.tax_rate === null || it.tax_rate === "" ? 7 : Number(it.tax_rate),
            c.line_total, i, now]
        );
      }
      await logQuotation(conn, id, user, sourceAction === "duplicate" ? "duplicate" : "create",
        null, Quo.STATUS.DRAFT, sourceAction === "duplicate" ? "ทำสำเนาจากเอกสารเดิม" : "สร้างใบเสนอราคาฉบับร่าง");
      await conn.commit();
      await appendCustomerActivity(doc.customer_id, `สร้างใบเสนอราคา ${number}`, user.display_name);
      return await getQuotation(id);
    } catch (e) {
      try { await conn.rollback(); } catch { /* noop */ }
      lastErr = e;
      if (isRetryableNumberError(e) && attempt < 7) continue; // เลขชนกัน/ชนล็อก → ลองใหม่
      throw e;
    } finally {
      conn.release();
    }
  }
  throw lastErr || new Error("สร้างเลขที่เอกสารไม่สำเร็จ");
}

/** บันทึก items ใหม่ (ลบของเดิมแล้วใส่ใหม่ — ใช้ใน transaction) */
async function replaceQuotationItems(conn, qid, items, now) {
  await conn.query("DELETE FROM quotation_items WHERE quotation_id = ?", [qid]);
  for (const [i, it] of items.entries()) {
    const c = Quo.calcLine(it);
    await conn.query(
      "INSERT INTO quotation_items (id, quotation_id, product_id, product_code_snapshot, product_name_snapshot, " +
      "description_snapshot, quantity, unit, unit_price, discount_type, discount_value, tax_rate, line_total, sort_order, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [newId("qi"), qid, it.product_id || null, it.product_code || null, it.product_name,
        it.description || null, it.quantity, it.unit || "หน่วย", it.unit_price,
        it.discount_type || null, it.discount_value === "" || it.discount_value === undefined || it.discount_value === null ? null : Number(it.discount_value),
        it.tax_rate === undefined || it.tax_rate === null || it.tax_rate === "" ? 7 : Number(it.tax_rate),
        c.line_total, i, now]
    );
  }
}

/* ---------------- seed ---------------- */
async function ensureSeed() {
  if (!(await getMeta("schema"))) await setMeta("schema", Seed.DEFAULT_SCHEMA);
  const [[{ c }]] = await pool.query("SELECT COUNT(*) AS c FROM records");
  if (Number(c) === 0) {
    const now = Date.now();
    const rows = Seed.makeRecords();
    for (const [i, rec] of rows.entries()) {
      await insertRecord({
        id: rec.id || "rec_seed_" + i,
        values: rec.values,
        activities: rec.activities,
        created_at: rec.created_at || now,
        updated_at: rec.updated_at || now,
        creator_id: null, creator_name: "ระบบ"
      });
    }
    console.log("[cmr] seeded demo data:", Seed.SEED_ROWS.length, "records");
  }
}

/* ---------------- helpers ---------------- */
function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { reject(new Error("ข้อมูลใหญ่เกินไป")); req.destroy(); return; }
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("JSON ไม่ถูกต้อง")); }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".csv": "text/csv; charset=utf-8",
  ".woff2": "font/woff2"
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      /* fallback: SPA route → index.html */
      if (!path.extname(filePath)) {
        fs.readFile(path.join(ROOT, "index.html"), (e2, b2) => {
          if (e2) { res.writeHead(404); res.end("Not Found"); return; }
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(b2);
        });
        return;
      }
      res.writeHead(404); res.end("Not Found");
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

/* ============================================================
   API
   ============================================================ */
async function handleApi(req, res, pathname) {
  const seg = pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;
  const action = seg[1];

  if (method === "OPTIONS") { res.writeHead(204); res.end(); return true; }

  /* ---------- public ---------- */
  if (action === "health" && method === "GET") {
    sendJson(res, 200, { ok: true, storage: "mysql", database: DB_NAME, host: DB.host + ":" + DB.port, auth: true });
    return true;
  }

  /* POST /api/auth/register */
  if (action === "auth" && seg[2] === "register" && method === "POST") {
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const displayName = String(body.display_name || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      sendJson(res, 400, { error: "ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ความยาว 3–32 ตัวอักษร" }); return true;
    }
    if (await findUserByUsername(username)) { sendJson(res, 409, { error: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" }); return true; }
    if (!displayName) { sendJson(res, 400, { error: "กรุณากรอกชื่อที่แสดง" }); return true; }
    if (password.length < 6) { sendJson(res, 400, { error: "รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร" }); return true; }

    const isFirst = (await countUsers()) === 0;
    const role = isFirst ? "admin" : "member";
    const user = {
      id: newId("usr"),
      username,
      display_name: displayName,
      email,
      password_hash: await hashPassword(password),
      role,
      active: 1,
      created_at: Date.now()
    };
    await pool.query(
      "INSERT INTO users (id, username, display_name, email, password_hash, role, active, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [user.id, user.username, user.display_name, user.email, user.password_hash, user.role, user.active, user.created_at]
    );

    await createSession(res, user.id);
    sendJson(res, 201, { user: publicUser(user), first_admin: isFirst });
    return true;
  }

  /* POST /api/auth/login */
  if (action === "auth" && seg[2] === "login" && method === "POST") {
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = await findUserByUsername(username);

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      sendJson(res, 401, { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }); return true;
    }
    if (!user.active) { sendJson(res, 403, { error: "บัญชีนี้ถูกระงับการใช้งาน" }); return true; }

    await createSession(res, user.id);
    sendJson(res, 200, { user: publicUser(user) });
    return true;
  }

  /* GET /api/auth/setup — ใช้แสดงคำแนะนำหน้า Login (สาธารณะ) */
  if (action === "auth" && seg[2] === "setup" && method === "GET") {
    sendJson(res, 200, { has_users: (await countUsers()) > 0 });
    return true;
  }

  /* GET /api/auth/me */
  if (action === "auth" && seg[2] === "me" && method === "GET") {
    sendJson(res, 200, { user: publicUser(await userFromRequest(req)) });
    return true;
  }

  /* POST /api/auth/logout */
  if (action === "auth" && seg[2] === "logout" && method === "POST") {
    await destroySession(req, res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  /* ---------- ต้องเข้าสู่ระบบ ---------- */
  const user = await userFromRequest(req);
  if (!user) { sendJson(res, 401, { error: "ต้องเข้าสู่ระบบก่อนใช้งาน" }); return true; }

  const needRole = (role) => {
    if (!isAdmin(user)) { sendJson(res, 403, { error: `ต้องเป็น${ROLE_LABELS.admin}เท่านั้น` }); return false; }
    return true;
  };
  const needWrite = () => {
    if (!canWrite(user)) { sendJson(res, 403, { error: "บัญชีผู้ชม (viewer) อ่านอย่างเดียว ไม่สามารถแก้ไขได้" }); return false; }
    return true;
  };

  /* ---------- ผู้ใช้ (admin เท่านั้น) ---------- */
  if (action === "users") {
    if (!needRole()) return true;

    if (seg.length === 2 && method === "GET") {
      const [rows] = await pool.query("SELECT * FROM users ORDER BY created_at ASC");
      const [counts] = await pool.query("SELECT creator_id, COUNT(*) AS c FROM records WHERE creator_id IS NOT NULL GROUP BY creator_id");
      const map = Object.fromEntries(counts.map((r) => [r.creator_id, Number(r.c)]));
      sendJson(res, 200, rows.map((u) => ({ ...publicUser(u), record_count: map[u.id] || 0 })));
      return true;
    }

    if (seg.length === 2 && method === "POST") {
      const body = await readBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const displayName = String(body.display_name || "").trim();
      const role = ROLES.includes(body.role) ? body.role : "member";
      const password = String(body.password || "");

      if (!/^[a-z0-9._-]{3,32}$/.test(username)) { sendJson(res, 400, { error: "ชื่อผู้ใช้ไม่ถูกต้อง (a-z 0-9 . _ - 3–32 ตัว)" }); return true; }
      if (await findUserByUsername(username)) { sendJson(res, 409, { error: "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว" }); return true; }
      if (!displayName) { sendJson(res, 400, { error: "กรุณากรอกชื่อที่แสดง" }); return true; }
      if (password.length < 6) { sendJson(res, 400, { error: "รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร" }); return true; }

      const created = {
        id: newId("usr"), username, display_name: displayName,
        email: String(body.email || "").trim(),
        password_hash: await hashPassword(password),
        role, active: 1, created_at: Date.now()
      };
      await pool.query(
        "INSERT INTO users (id, username, display_name, email, password_hash, role, active, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [created.id, created.username, created.display_name, created.email, created.password_hash, created.role, created.active, created.created_at]
      );
      sendJson(res, 201, { user: publicUser(created) });
      return true;
    }

    if (seg.length === 3 && method === "PATCH") {      const id = decodeURIComponent(seg[2]);
      const target = await findUserById(id);
      if (!target) { sendJson(res, 404, { error: "ไม่พบผู้ใช้" }); return true; }
      const body = await readBody(req);

      if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) { sendJson(res, 400, { error: "บทบาทไม่ถูกต้อง" }); return true; }
        const losingAdmin = target.role === "admin" && body.role !== "admin";
        if (losingAdmin && (await countActiveAdmins()) <= 1) {
          sendJson(res, 400, { error: "ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน" }); return true;
        }
        target.role = body.role;
      }
      if (body.active !== undefined) {
        const next = body.active ? 1 : 0;
        if (next === 0 && target.id === user.id) { sendJson(res, 400, { error: "ระงับบัญชีตัวเองไม่ได้" }); return true; }
        if (next === 0 && target.role === "admin" && (await countActiveAdmins()) <= 1) {
          sendJson(res, 400, { error: "ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน" }); return true;
        }
        target.active = next;
        if (!next) await pool.query("DELETE FROM sessions WHERE user_id = ?", [target.id]); // เด้งออกทันที
      }
      if (body.display_name !== undefined) {
        const dn = String(body.display_name).trim();
        if (!dn) { sendJson(res, 400, { error: "ชื่อที่แสดงห้ามว่าง" }); return true; }
        target.display_name = dn;
      }
      if (body.avatar !== undefined) {
        const a = body.avatar;
        if (a === null || a === "") target.avatar = null;
        else if (typeof a === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(a) && a.length <= 1400000) {
          target.avatar = a;
        } else {
          sendJson(res, 400, { error: "ไฟล์รูปภาพไม่ถูกต้องหรือใหญ่เกินไป (สูงสุด 1 MB)" }); return true;
        }
      }
      if (body.email !== undefined) target.email = String(body.email).trim();
      if (body.password !== undefined) {
        if (String(body.password).length < 6) { sendJson(res, 400, { error: "รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร" }); return true; }
        target.password_hash = await hashPassword(body.password);
        await pool.query("DELETE FROM sessions WHERE user_id = ?", [target.id]); // บังคับ login ใหม่
      }

      await pool.query(
        "UPDATE users SET display_name = ?, email = ?, role = ?, active = ?, password_hash = ?, avatar = ? WHERE id = ?",
        [target.display_name, target.email, target.role, target.active, target.password_hash, target.avatar || null, target.id]
      );
      sendJson(res, 200, { user: publicUser(target) });
      return true;
    }

    if (seg.length === 3 && method === "DELETE") {
      const id = decodeURIComponent(seg[2]);
      const target = await findUserById(id);
      if (!target) { sendJson(res, 404, { error: "ไม่พบผู้ใช้" }); return true; }
      if (target.id === user.id) { sendJson(res, 400, { error: "ลบบัญชีตัวเองไม่ได้" }); return true; }
      if (target.role === "admin" && (await countActiveAdmins()) <= 1) {
        sendJson(res, 400, { error: "ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน" }); return true;
      }
      await pool.query("DELETE FROM sessions WHERE user_id = ?", [id]);
      await pool.query("UPDATE records SET creator_id = NULL WHERE creator_id = ?", [id]);
      await pool.query("DELETE FROM users WHERE id = ?", [id]);
      sendJson(res, 200, { ok: true, id });
      return true;
    }
  }

  /* ---------- โครงสร้างฟิลด์ ---------- */
  if (action === "app" && method === "GET") {
    sendJson(res, 200, await getMeta("schema", Seed.DEFAULT_SCHEMA));
    return true;
  }
  if (action === "app" && method === "PUT") {
    if (!needRole()) return true;
    const body = await readBody(req);
    const schema = body && body.schema;
    if (!schema || !Array.isArray(schema.fields) || !schema.fields.length) {
      sendJson(res, 400, { error: "schema ไม่ถูกต้อง" }); return true;
    }
    const keys = new Set();
    for (const f of schema.fields) {
      if (!f.key || !f.label) { sendJson(res, 400, { error: "ฟิลด์ต้องมี key และ label" }); return true; }
      if (keys.has(f.key)) { sendJson(res, 400, { error: "key ซ้ำ: " + f.key }); return true; }
      keys.add(f.key);
    }
    await setMeta("schema", schema);
    sendJson(res, 200, schema);
    return true;
  }

  /* ---------- ระเบียน ---------- */
  if (action === "records" && seg.length === 2 && method === "GET") {
    sendJson(res, 200, await listRecords());
    return true;
  }

  if (action === "records" && seg.length === 2 && method === "POST") {
    if (!needWrite()) return true;
    const body = await readBody(req);
    const values = { ...((body && body.values) || {}) };
    const schema = await getMeta("schema", Seed.DEFAULT_SCHEMA);
    /* ถ้าไม่ได้ระบุผู้รับผิดชอบ ให้ตั้งเป็นคนสร้าง */
    if (schema.fields.some((f) => f.key === "owner") && !values.owner) values.owner = user.display_name;

    const now = Date.now();
    const rec = {
      id: newId(),
      values,
      created_at: now,
      updated_at: now,
      creator_id: user.id,
      creator_name: user.display_name,
      activities: [{ id: newId("a"), type: "create", text: "สร้างระเบียน", author: user.display_name, at: now }]
    };
    await insertRecord(rec);
    sendJson(res, 201, rec);
    return true;
  }

  if (action === "records" && seg.length >= 3) {
    const id = decodeURIComponent(seg[2]);
    const schema = await getMeta("schema", Seed.DEFAULT_SCHEMA);
    const rec = await getRecord(id);
    if (!rec) { sendJson(res, 404, { error: "ไม่พบระเบียน" }); return true; }

    if (method === "GET" && !seg[3]) { sendJson(res, 200, rec); return true; }

    if (method === "PUT" && !seg[3]) {
      if (!needWrite()) return true;
      if (!canEditRecord(user, rec)) {
        sendJson(res, 403, { error: "คุณไม่มีสิทธิ์แก้ไขระเบียนนี้ (แก้ได้เฉพาะระเบียนที่คุณสร้างหรือเป็นผู้รับผิดชอบ)" });
        return true;
      }
      const body = await readBody(req);
      const patch = (body && body.values) || {};
      const changed = Object.keys(patch).filter(
        (k) => JSON.stringify(rec.values[k]) !== JSON.stringify(patch[k])
      );
      rec.values = { ...rec.values, ...patch };
      rec.updated_at = Date.now();
      if (changed.length) {
        rec.activities.push({
          id: newId("a"), type: "update",
          text: "แก้ไขฟิลด์: " + changed.map((k) => fieldLabel(schema, k)).join(", "),
          author: user.display_name, at: rec.updated_at
        });
      }
      await updateRecordRow(rec);
      sendJson(res, 200, rec);
      return true;
    }

    if (method === "DELETE" && !seg[3]) {
      if (!needWrite()) return true;
      if (!canDeleteRecord(user, rec)) {
        sendJson(res, 403, { error: "คุณไม่มีสิทธิ์ลบระเบียนนี้ (ลบได้เฉพาะระเบียนที่คุณสร้าง หรือผู้ดูแลระบบ)" });
        return true;
      }
      /* กฎรองรับ: ห้ามลบลูกค้าที่ยังมีใบเสนอราคาอ้างอิง (ป้องกันเอกสารสูญหาย/หลุด FK) */
      const [[{ c: refCount }]] = await pool.query("SELECT COUNT(*) AS c FROM quotations WHERE customer_id = ?", [id]);
      if (Number(refCount) > 0) {
        sendJson(res, 409, { error: `ลบลูกค้าไม่ได้: มีใบเสนอราคาอ้างอิงลูกค้านี้ ${refCount} ฉบับ — ให้ยกเลิกหรือลบเอกสารเหล่านั้นก่อน` });
        return true;
      }
      await pool.query("DELETE FROM records WHERE id = ?", [id]);
      sendJson(res, 200, { ok: true, id });
      return true;
    }

    if (method === "POST" && seg[3] === "comments") {
      if (!needWrite()) return true;
      const body = await readBody(req);
      const text = String((body && body.text) || "").trim();
      if (!text) { sendJson(res, 400, { error: "ข้อความว่าง" }); return true; }
      const at = Date.now();
      rec.activities.push({ id: newId("a"), type: "comment", text, author: user.display_name, at });
      rec.updated_at = at;
      await updateRecordRow(rec);
      sendJson(res, 200, rec);
      return true;
    }

    if (method === "POST" && seg[3] === "status") {
      if (!needWrite()) return true;
      if (!canEditRecord(user, rec)) {
        sendJson(res, 403, { error: "คุณไม่มีสิทธิ์เปลี่ยนสถานะระเบียนนี้" });
        return true;
      }
      const body = await readBody(req);
      const status = String((body && body.status) || "").trim();
      if (!status) { sendJson(res, 400, { error: "สถานะว่าง" }); return true; }
      const old = rec.values.status || "—";
      rec.values.status = status;
      rec.updated_at = Date.now();
      rec.activities.push({
        id: newId("a"), type: "status",
        text: `เปลี่ยนสถานะ: ${old} → ${status}`, author: user.display_name, at: rec.updated_at
      });
      await updateRecordRow(rec);
      sendJson(res, 200, rec);
      return true;
    }
  }

  /* ============================================================
     ใบเสนอราคา (Quotations)
     ============================================================ */
  if (action === "quotations") {
    const sub = seg[2] ? decodeURIComponent(seg[2]) : null;

    /* ---------- รายการ (กรอง/ค้นหา/เรียง/แบ่งหน้า) ---------- */
    if (seg.length === 2 && method === "GET") {
      const qp = new URL(req.url, "http://localhost").searchParams;
      const page = Math.max(1, parseInt(qp.get("page"), 10) || 1);
      const perPage = Math.min(200, Math.max(1, parseInt(qp.get("per_page"), 10) || 20));
      const where = [];
      const args = [];
      const q = (qp.get("q") || "").trim();
      if (q) { where.push("(quotation_number LIKE ? OR customer_name LIKE ?)"); args.push("%" + q + "%", "%" + q + "%"); }
      const status = qp.get("status") || "";
      if (status) { where.push("status = ?"); args.push(status); }
      const customerId = qp.get("customer_id") || "";
      if (customerId) { where.push("customer_id = ?"); args.push(customerId); }
      const from = qp.get("from") || "";
      if (from) { where.push("issue_date >= ?"); args.push(from); }
      const to = qp.get("to") || "";
      if (to) { where.push("issue_date <= ?"); args.push(to); }
      const owner = qp.get("owner") || "";
      if (owner) { where.push("owner = ?"); args.push(owner); }
      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";

      const sortWhitelist = {
        quotation_number: "quotation_number", issue_date: "issue_date", expiry_date: "expiry_date",
        grand_total: "grand_total", status: "status", customer_name: "customer_name",
        created_at: "created_at", updated_at: "updated_at"
      };
      const sortKey = sortWhitelist[qp.get("sort")] || "updated_at";
      const sortDir = qp.get("dir") === "asc" ? "ASC" : "DESC";

      await markExpiredQuotations();
      const [[{ c: total }]] = await pool.query("SELECT COUNT(*) AS c FROM quotations" + whereSql, args);
      const [rows] = await pool.query(
        `SELECT * FROM quotations${whereSql} ORDER BY ${sortKey} ${sortDir}, id DESC LIMIT ? OFFSET ?`,
        [...args, perPage, (page - 1) * perPage]
      );
      sendJson(res, 200, {
        items: rows.map(rowToQuotation),
        total: Number(total), page, per_page: perPage
      });
      return true;
    }

    /* ---------- ภาพรวม/สถิติ ---------- */
    if (seg.length === 3 && sub === "stats" && method === "GET") {
      await markExpiredQuotations();
      const [byStatus] = await pool.query(
        "SELECT status, COUNT(*) AS c, COALESCE(SUM(grand_total), 0) AS total_value FROM quotations GROUP BY status"
      );
      const counts = {};
      const values = {};
      for (const s of Quo.STATUS_ORDER) { counts[s] = 0; values[s] = 0; }
      for (const r of byStatus) { counts[r.status] = Number(r.c); values[r.status] = Number(r.total_value); }
      const [[{ c: totalDocs }]] = await pool.query("SELECT COUNT(*) AS c FROM quotations");
      const [[{ tv }]] = await pool.query("SELECT COALESCE(SUM(grand_total), 0) AS tv FROM quotations WHERE status <> 'Cancelled'");
      const [[{ av }]] = await pool.query("SELECT COALESCE(SUM(grand_total), 0) AS av FROM quotations WHERE status = 'Approved'");
      sendJson(res, 200, {
        counts, values,
        total_documents: Number(totalDocs),
        total_value: Number(tv),
        approved_value: Number(av),
        pending_count: counts[Quo.STATUS.PENDING]
      });
      return true;
    }

    /* ---------- สร้างใบเสนอราคาใหม่ ---------- */
    if (seg.length === 2 && method === "POST") {
      if (!needWrite()) return true;
      const body = await readBody(req);
      const doc = body || {};
      const items = Array.isArray(doc.items) ? doc.items : [];
      const err = Quo.validateDocument({ ...doc, items });
      if (err) { sendJson(res, 400, { error: err }); return true; }
      if (doc.customer_id) {
        const cust = await getRecord(doc.customer_id);
        if (!cust) { sendJson(res, 400, { error: "ไม่พบลูกค้าที่เลือก (ระเบียนอาจถูกลบ)" }); return true; }
      }
      const totals = Quo.calcTotals({ ...doc, items }); // server คำนวณเองเสมอ ไม่ยอมรับค่าจาก client
      const created = await createQuotationTx({
        doc, items, totals, user,
        sourceAction: doc.source_quotation_id ? "duplicate" : "create"
      });
      sendJson(res, 201, { quotation: created, items: await getQuotationItems(created.id) });
      return true;
    }

    /* ---------- รายละเอียด ---------- */
    if (seg.length === 3 && method === "GET") {
      const q = await getQuotation(sub);
      if (!q) { sendJson(res, 404, { error: "ไม่พบใบเสนอราคา" }); return true; }
      sendJson(res, 200, { quotation: q, items: await getQuotationItems(q.id), logs: await getQuotationLogs(q.id) });
      return true;
    }

    /* ---------- แก้ไข (เฉพาะสถานะที่ยังแก้ได้) ---------- */
    if (seg.length === 3 && method === "PUT") {
      if (!needWrite()) return true;
      const q = await getQuotation(sub);
      if (!q) { sendJson(res, 404, { error: "ไม่พบใบเสนอราคา" }); return true; }
      if (!canEditQuotation(user, q)) { sendJson(res, 403, { error: "คุณไม่มีสิทธิ์แก้ไขใบเสนอราคาฉบับนี้" }); return true; }
      if (!Quo.EDITABLE_STATUSES.includes(q.status)) {
        sendJson(res, 409, { error: "เอกสารสถานะนี้แก้ไขไม่ได้ — ใช้ปุ่มทำสำเนาเพื่อสร้างฉบับแก้ไขใหม่" }); return true;
      }
      const body = await readBody(req);
      const doc = body || {};
      const items = Array.isArray(doc.items) ? doc.items : [];
      const err = Quo.validateDocument({ ...doc, items });
      if (err) { sendJson(res, 400, { error: err }); return true; }
      if (doc.customer_id) {
        const cust = await getRecord(doc.customer_id);
        if (!cust) { sendJson(res, 400, { error: "ไม่พบลูกค้าที่เลือก (ระเบียนอาจถูกลบ)" }); return true; }
      }
      const totals = Quo.calcTotals({ ...doc, items });
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          "UPDATE quotations SET customer_id = ?, customer_name = ?, customer_address = ?, customer_tax_id = ?, " +
          "contact_name = ?, contact_email = ?, contact_phone = ?, issue_date = ?, expiry_date = ?, tax_mode = ?, tax_rate = ?, " +
          "subtotal = ?, discount_type = ?, discount_value = ?, discount_amount = ?, taxable_amount = ?, tax_amount = ?, grand_total = ?, " +
          "currency = ?, payment_terms = ?, notes = ?, owner = ?, prepared_by = ?, updated_at = ? WHERE id = ?",
          [doc.customer_id || null, doc.customer_name, doc.customer_address || null, doc.customer_tax_id || null,
            doc.contact_name || null, doc.contact_email || null, doc.contact_phone || null,
            doc.issue_date, doc.expiry_date || null, doc.tax_mode, totals.tax_rate,
            totals.subtotal, doc.discount_type || null,
            doc.discount_value === "" || doc.discount_value === undefined || doc.discount_value === null ? null : Number(doc.discount_value),
            totals.discount_amount, totals.taxable_amount, totals.tax_amount, totals.grand_total,
            doc.currency || "THB", doc.payment_terms || null, doc.notes || null,
            doc.owner || q.owner, doc.prepared_by || q.prepared_by, Date.now(), q.id]
        );
        await replaceQuotationItems(conn, q.id, items, Date.now());
        await logQuotation(conn, q.id, user, "update", q.status, q.status, "แก้ไขรายละเอียดเอกสาร");
        await conn.commit();
      } catch (e) {
        try { await conn.rollback(); } catch { /* noop */ }
        throw e;
      } finally {
        conn.release();
      }
      await appendCustomerActivity(doc.customer_id, `แก้ไขใบเสนอราคา ${q.quotation_number}`, user.display_name);
      const fresh = await getQuotation(q.id);
      sendJson(res, 200, { quotation: fresh, items: await getQuotationItems(q.id) });
      return true;
    }

    /* ---------- เปลี่ยนสถานะ ---------- */
    if (seg.length === 4 && sub && seg[3] === "status" && method === "POST") {
      if (!needWrite()) return true;
      const q = await getQuotation(sub);
      if (!q) { sendJson(res, 404, { error: "ไม่พบใบเสนอราคา" }); return true; }
      const body = await readBody(req);
      const to = String((body && body.status) || "").trim();
      if (!Quo.STATUS_ORDER.includes(to)) { sendJson(res, 400, { error: "สถานะไม่ถูกต้อง" }); return true; }
      /* กฎสิทธิ์: อนุมัติ/ไม่อนุมัติได้ทุกคนที่มีสิทธิ์เขียน · ส่ง/ยกเลิก/กู้สถานะ ต้องเป็นเจ้าของเอกสารหรือ admin */
      const approveFlow = [Quo.STATUS.APPROVED, Quo.STATUS.REJECTED].includes(to);
      if (!approveFlow && !canEditQuotation(user, q)) {
        sendJson(res, 403, { error: "คุณไม่มีสิทธิ์เปลี่ยนสถานะเอกสารนี้" }); return true;
      }
      if (q.status === to) { sendJson(res, 200, { quotation: q }); return true; }
      if (!Quo.canChangeStatus(q.status, to)) {
        sendJson(res, 409, { error: `เปลี่ยนสถานะจาก "${Quo.STATUS_LABELS[q.status]}" เป็น "${Quo.STATUS_LABELS[to]}" ไม่ได้` });
        return true;
      }
      const now = Date.now();
      const approvedBy = to === Quo.STATUS.APPROVED ? user.id : (q.approved_by || null);
      const approvedByName = to === Quo.STATUS.APPROVED ? user.display_name : (q.approved_by_name || null);
      const approvedAt = to === Quo.STATUS.APPROVED ? now : (q.approved_at || null);
      await pool.query(
        "UPDATE quotations SET status = ?, approved_by = ?, approved_by_name = ?, approved_at = ?, updated_at = ? WHERE id = ?",
        [to, approvedBy, approvedByName, approvedAt, now, q.id]
      );
      await logQuotation(pool, q.id, user, "status", q.status, to,
        `${Quo.STATUS_LABELS[q.status]} → ${Quo.STATUS_LABELS[to]}`);
      await appendCustomerActivity(q.customer_id,
        `ใบเสนอราคา ${q.quotation_number}: ${Quo.STATUS_LABELS[q.status]} → ${Quo.STATUS_LABELS[to]}`, user.display_name);
      sendJson(res, 200, { quotation: await getQuotation(q.id) });
      return true;
    }

    /* ---------- ทำสำเนา (ฉบับแก้ไขใหม่ = Draft เสมอ) ---------- */
    if (seg.length === 4 && sub && seg[3] === "duplicate" && method === "POST") {
      if (!needWrite()) return true;
      const src = await getQuotation(sub);
      if (!src) { sendJson(res, 404, { error: "ไม่พบใบเสนอราคาต้นฉบับ" }); return true; }
      const items = await getQuotationItems(src.id);
      const doc = {
        customer_id: src.customer_id, customer_name: src.customer_name,
        customer_address: src.customer_address, customer_tax_id: src.customer_tax_id,
        contact_name: src.contact_name, contact_email: src.contact_email, contact_phone: src.contact_phone,
        issue_date: Quo.todayISO(), expiry_date: "", tax_mode: src.tax_mode, tax_rate: src.tax_rate,
        discount_type: src.discount_type, discount_value: src.discount_value,
        currency: src.currency, payment_terms: src.payment_terms, notes: src.notes,
        owner: src.owner, prepared_by: user.display_name
      };
      const totals = Quo.calcTotals({ ...doc, items });
      const created = await createQuotationTx({ doc, items, totals, user, sourceAction: "duplicate" });
      await appendCustomerActivity(created.customer_id, `ทำสำเนาใบเสนอราคา ${created.quotation_number} จาก ${src.quotation_number}`, user.display_name);
      sendJson(res, 201, { quotation: created, items: await getQuotationItems(created.id), source: src.quotation_number });
      return true;
    }

    /* ---------- ลบ (admin หรือคนสร้าง — เอกสารอนุมัติแล้วลบเฉพาะ admin) ---------- */
    if (seg.length === 3 && method === "DELETE") {
      if (!needWrite()) return true;
      const q = await getQuotation(sub);
      if (!q) { sendJson(res, 404, { error: "ไม่พบใบเสนอราคา" }); return true; }
      if (!canDeleteQuotation(user, q)) {
        sendJson(res, 403, { error: q.status === Quo.STATUS.APPROVED
          ? "เอกสารที่อนุมัติแล้วลบได้เฉพาะผู้ดูแลระบบ"
          : "คุณไม่มีสิทธิ์ลบใบเสนอราคาฉบับนี้ (ลบได้เฉพาะเอกสารที่คุณสร้าง หรือผู้ดูแลระบบ)" });
        return true;
      }
      /* items + logs ถูกลบตามด้วย FK ON DELETE CASCADE */
      await pool.query("DELETE FROM quotations WHERE id = ?", [q.id]);
      await appendCustomerActivity(q.customer_id, `ลบใบเสนอราคา ${q.quotation_number}`, user.display_name);
      sendJson(res, 200, { ok: true, id: q.id });
      return true;
    }
  }

  /* ============================================================
     คลังสินค้า/บริการ (Products)
     ============================================================ */
  if (action === "products") {
    const sub = seg[2] ? decodeURIComponent(seg[2]) : null;

    if (seg.length === 2 && method === "GET") {
      const qp = new URL(req.url, "http://localhost").searchParams;
      const where = [];
      const args = [];
      const q = (qp.get("q") || "").trim();
      if (q) { where.push("(code LIKE ? OR name LIKE ?)"); args.push("%" + q + "%", "%" + q + "%"); }
      if (qp.get("active") === "1") where.push("active = 1");
      const whereSql = where.length ? " WHERE " + where.join(" AND ") : "";
      const [rows] = await pool.query("SELECT * FROM products" + whereSql + " ORDER BY name ASC LIMIT 500", args);
      sendJson(res, 200, rows.map(rowToProduct));
      return true;
    }

    if (seg.length === 2 && method === "POST") {
      if (!needWrite()) return true;
      const b = await readBody(req);
      const name = String((b && b.name) || "").trim();
      if (!name) { sendJson(res, 400, { error: "ต้องระบุชื่อสินค้า/บริการ" }); return true; }
      const code = String((b && b.code) || "").trim() || null;
      if (code) {
        const [[{ c }]] = await pool.query("SELECT COUNT(*) AS c FROM products WHERE code = ?", [code]);
        if (Number(c) > 0) { sendJson(res, 409, { error: "รหัสสินค้านี้มีอยู่แล้ว" }); return true; }
      }
      const now = Date.now();
      const p = {
        id: newId("prd"), code, name,
        description: String((b && b.description) || "").trim(),
        unit: String((b && b.unit) || "หน่วย").trim() || "หน่วย",
        unit_price: Math.max(0, Number((b && b.unit_price) || 0) || 0),
        tax_rate: Math.min(100, Math.max(0, Number((b && b.tax_rate) === undefined ? 7 : b.tax_rate) || 0)),
        active: b && b.active === false ? 0 : 1,
        creator_id: user.id, creator_name: user.display_name,
        created_at: now, updated_at: now
      };
      await pool.query(
        "INSERT INTO products (id, code, name, description, unit, unit_price, tax_rate, active, creator_id, creator_name, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [p.id, p.code, p.name, p.description, p.unit, p.unit_price, p.tax_rate, p.active, p.creator_id, p.creator_name, p.created_at, p.updated_at]
      );
      sendJson(res, 201, rowToProduct(p));
      return true;
    }

    if (seg.length === 3 && (method === "PATCH" || method === "PUT")) {
      if (!needWrite()) return true;
      const [rows] = await pool.query("SELECT * FROM products WHERE id = ?", [sub]);
      const cur = rows[0];
      if (!cur) { sendJson(res, 404, { error: "ไม่พบสินค้า" }); return true; }
      const b = await readBody(req);
      const next = {
        code: b.code === undefined ? cur.code : (String(b.code).trim() || null),
        name: b.name === undefined ? cur.name : String(b.name).trim(),
        description: b.description === undefined ? cur.description : String(b.description).trim(),
        unit: b.unit === undefined ? cur.unit : String(b.unit).trim(),
        unit_price: b.unit_price === undefined ? Number(cur.unit_price) : Math.max(0, Number(b.unit_price) || 0),
        tax_rate: b.tax_rate === undefined ? Number(cur.tax_rate) : Math.min(100, Math.max(0, Number(b.tax_rate) || 0)),
        active: b.active === undefined ? cur.active : (b.active ? 1 : 0)
      };
      if (!next.name) { sendJson(res, 400, { error: "ต้องระบุชื่อสินค้า/บริการ" }); return true; }
      if (next.code && next.code !== cur.code) {
        const [[{ c }]] = await pool.query("SELECT COUNT(*) AS c FROM products WHERE code = ? AND id <> ?", [next.code, sub]);
        if (Number(c) > 0) { sendJson(res, 409, { error: "รหัสสินค้านี้มีอยู่แล้ว" }); return true; }
      }
      await pool.query(
        "UPDATE products SET code = ?, name = ?, description = ?, unit = ?, unit_price = ?, tax_rate = ?, active = ?, updated_at = ? WHERE id = ?",
        [next.code, next.name, next.description, next.unit, next.unit_price, next.tax_rate, next.active, Date.now(), sub]
      );
      const [fresh] = await pool.query("SELECT * FROM products WHERE id = ?", [sub]);
      sendJson(res, 200, rowToProduct(fresh[0]));
      return true;
    }

    if (seg.length === 3 && method === "DELETE") {
      if (!needRole()) return true; // ลบคลังสินค้า: admin เท่านั้น (รายการเอกสารเก่าไม่กระทบ — เก็บ snapshot ไว้แล้ว)
      const [rows] = await pool.query("SELECT id FROM products WHERE id = ?", [sub]);
      if (!rows.length) { sendJson(res, 404, { error: "ไม่พบสินค้า" }); return true; }
      /* product_id ใน items จะถูกตั้งเป็น NULL ด้วย FK ON DELETE SET NULL — snapshot ยังอยู่ครบ */
      await pool.query("DELETE FROM products WHERE id = ?", [sub]);
      sendJson(res, 200, { ok: true, id: sub });
      return true;
    }
  }

  /* ============================================================
     ตั้งค่าเอกสารใบเสนอราคา (meta: quotation_settings)
     ============================================================ */
  if (action === "qsettings") {
    const defaults = {
      company_name: "", company_address: "", company_tax_id: "", company_phone: "", company_email: "",
      logo_text: "", logo_url: "", default_payment_terms: "", default_notes: "",
      default_tax_rate: 7, default_tax_mode: "exclusive", default_validity_days: 30
    };
    if (method === "GET") {
      const saved = await getMeta("quotation_settings", {});
      sendJson(res, 200, { ...defaults, ...saved });
      return true;
    }
    if (method === "PUT") {
      if (!needRole()) return true; // ตั้งค่าเอกสาร: admin เท่านั้น (ตามสิทธิ์เดิมของระบบ)
      const b = await readBody(req);
      const cur = await getMeta("quotation_settings", {});
      const next = { ...cur };
      const textKeys = ["company_name", "company_address", "company_tax_id", "company_phone", "company_email",
        "logo_text", "logo_url", "default_payment_terms", "default_notes"];
      for (const k of textKeys) if (b[k] !== undefined) next[k] = String(b[k]).trim();
      if (b.default_tax_rate !== undefined) {
        const r = Number(b.default_tax_rate);
        if (!Number.isFinite(r) || r < 0 || r > 100) { sendJson(res, 400, { error: "อัตรา VAT ต้องอยู่ระหว่าง 0–100" }); return true; }
        next.default_tax_rate = r;
      }
      if (b.default_tax_mode !== undefined) {
        if (!Quo.TAX_MODES[b.default_tax_mode]) { sendJson(res, 400, { error: "รูปแบบ VAT ไม่ถูกต้อง" }); return true; }
        next.default_tax_mode = b.default_tax_mode;
      }
      if (b.default_validity_days !== undefined) {
        const d = parseInt(b.default_validity_days, 10);
        if (!Number.isFinite(d) || d < 0 || d > 3650) { sendJson(res, 400, { error: "อายุเอกสารต้องอยู่ระหว่าง 0–3650 วัน" }); return true; }
        next.default_validity_days = d;
      }
      await setMeta("quotation_settings", next);
      sendJson(res, 200, { ...defaults, ...next });
      return true;
    }
  }

  /* ---------- รีเซ็ตข้อมูล (admin) ---------- */
  if (action === "reset" && method === "POST") {
    if (!needRole()) return true;
    await pool.query("DELETE FROM records");
    await setMeta("schema", Seed.DEFAULT_SCHEMA);
    const rows = Seed.makeRecords();
    for (const [i, rec] of rows.entries()) {
      await insertRecord({ ...rec, id: rec.id || "rec_seed_" + i, creator_id: null, creator_name: "ระบบ" });
    }
    sendJson(res, 200, { ok: true, records: (await listRecords()).length });
    return true;
  }

  sendJson(res, 404, { error: "ไม่พบ endpoint: " + method + " " + pathname });
  return true;
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error("[cmr] error", e);
    if (!res.headersSent) sendJson(res, 500, { error: e.message || "เซิร์ฟเวอร์ผิดพลาด" });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[cmr] พอร์ต ${PORT} ถูกใช้งานแล้ว — ลองรันด้วยพอร์ตอื่น เช่น  PORT=3001 node server.js`);
    process.exit(1);
  }
  throw err;
});

/* เริ่ม: สร้าง schema ถ้ายังไม่มี → seed ถ้าจำเป็น → ค่อยเปิดพอร์ต */
(async () => {
  try {
    await ensureSchema();
    await ensureSeed();
  } catch (e) {
    console.error("[cmr] เชื่อมต่อ MySQL ไม่สำเร็จ:", e.code || e.message);
    console.error("      ตรวจ env DB_HOST/DB_USER/DB_PASSWORD/DB_NAME (หรือ DATABASE_URL ทั้งก้อน) และว่า MySQL รันอยู่");
    if (DB.ssl) console.error("      ถ้าใช้ platform ที่บังคับ SSL เช่น Render ลอง DB_SSL_REJECT_UNAUTHORIZED=0");
    process.exit(1);
  }

  server.listen(PORT, async () => {
    const users = await countUsers();
    console.log("--------------------------------------------------");
    console.log("  Qwikflow CRM พร้อมใช้งาน");
    console.log("  เปิดเบราว์เซอร์ที่  http://localhost:" + PORT);
    console.log("  ฐานข้อมูล MySQL ที่  " + DB.host + ":" + DB.port + "/" + DB_NAME);
    console.log(users === 0
      ? "  ยังไม่มีผู้ใช้: สร้างบัญชีแรกผ่าน API POST /api/auth/register (บัญชีแรกได้สิทธิ์ admin)"
      : "  มีผู้ใช้ในระบบแล้ว " + users + " บัญชี");
    console.log("--------------------------------------------------");
  });
})();
