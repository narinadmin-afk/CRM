/* ============================================================
   models/customerModel.js — ชั้นเข้าถึงฐานข้อมูล (MySQL)
   ** ทุกคำสั่งใช้ Prepared Statements (? placeholder) เท่านั้น
      ไม่มี string concatenation ของค่าจากผู้ใช้ใน SQL เด็ดขาด
   ** ชื่อคอลัมน์มาจาก whitelist ใน config/constants.js เท่านั้น
   ============================================================ */
const { pool } = require("../config/db");
const { CUSTOMER_COLUMNS, CUSTOMER_SELECT } = require("../config/constants");

const TABLE = "customers";
const SEL = CUSTOMER_SELECT.join(", ");

/* ---------- ดึงข้อมูลทั้งหมด (กรอง/เรียงได้) ---------- */
async function findAll({ search = "", status = "" } = {}) {
  const where = [];
  const params = [];

  if (search) {
    where.push(`(customer_code LIKE ? OR first_name LIKE ? OR last_name LIKE ?
        OR company LIKE ? OR email LIKE ? OR phone LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }

  const sql = `SELECT ${SEL} FROM ${TABLE}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY id DESC LIMIT 500`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/* ---------- ค้นหา (ใช้ prepared LIKE) ---------- */
function search(term) {
  return findAll({ search: term });
}

/* ---------- ดึงรายบุคคล ---------- */
async function findById(id) {
  const [rows] = await pool.execute(`SELECT ${SEL} FROM ${TABLE} WHERE id = ?`, [id]);
  return rows[0] || null;
}

/* ---------- เพิ่มลูกค้า ---------- */
async function create(data) {
  const cols = CUSTOMER_COLUMNS.filter((c) => data[c] !== undefined);
  const placeholders = cols.map(() => "?").join(", ");
  const values = cols.map((c) => data[c]);

  const [result] = await pool.execute(
    `INSERT INTO ${TABLE} (${cols.join(", ")}) VALUES (${placeholders})`,
    values
  );
  return findById(result.insertId);
}

/* ---------- แก้ไขลูกค้า (partial: มี field ไหนก็แก้ field นั้น) ---------- */
async function update(id, data) {
  const cols = CUSTOMER_COLUMNS.filter((c) => data[c] !== undefined);
  if (cols.length === 0) return findById(id);

  const setSql = cols.map((c) => `${c} = ?`).join(", ");
  const values = cols.map((c) => data[c]);
  values.push(id);

  await pool.execute(`UPDATE ${TABLE} SET ${setSql} WHERE id = ?`, values);
  return findById(id);
}

/* ---------- ลบลูกค้า ---------- */
async function remove(id) {
  const [result] = await pool.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

module.exports = { findAll, search, findById, create, update, remove };
