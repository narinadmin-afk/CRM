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
  multipleStatements: false
});

/** สร้างฐานข้อมูล/ตารางจาก sql/schema.mysql.sql (idempotent — รันได้ทุกครั้งตอนเริ่ม) */
async function ensureSchema() {
  const ddl = fs.readFileSync(path.join(ROOT, "sql", "schema.mysql.sql"), "utf8")
    .replace(/`cmr`/g, "`" + DB_NAME + "`");
  const conn = await mysql.createConnection({ ...DB, multipleStatements: true, charset: "utf8mb4" });
  try {
    await conn.query(ddl);
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
    email: u.email, role: u.role, role_label: ROLE_LABELS[u.role] || u.role,
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
      if (body.email !== undefined) target.email = String(body.email).trim();
      if (body.password !== undefined) {
        if (String(body.password).length < 6) { sendJson(res, 400, { error: "รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร" }); return true; }
        target.password_hash = await hashPassword(body.password);
        await pool.query("DELETE FROM sessions WHERE user_id = ?", [target.id]); // บังคับ login ใหม่
      }

      await pool.query(
        "UPDATE users SET display_name = ?, email = ?, role = ?, active = ?, password_hash = ? WHERE id = ?",
        [target.display_name, target.email, target.role, target.active, target.password_hash, target.id]
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
    console.log("  Tarmtid.com พร้อมใช้งาน");
    console.log("  เปิดเบราว์เซอร์ที่  http://localhost:" + PORT);
    console.log("  ฐานข้อมูล MySQL ที่  " + DB.host + ":" + DB.port + "/" + DB_NAME);
    console.log(users === 0
      ? "  ยังไม่มีผู้ใช้: สร้างบัญชีแรกผ่าน API POST /api/auth/register (บัญชีแรกได้สิทธิ์ admin)"
      : "  มีผู้ใช้ในระบบแล้ว " + users + " บัญชี");
    console.log("--------------------------------------------------");
  });
})();
