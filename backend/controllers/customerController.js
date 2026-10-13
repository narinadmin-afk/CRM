/* ============================================================
   controllers/customerController.js — จัดการ Request/Response
   ตอบกลับรูปแบบเดียวกันทุกจุด:
     สำเร็จ → { success:true, message:"...", data:{...} }
     ผิดพลาด → { success:false, message:"..." } (+ errors ตอน validate ไม่ผ่าน)
   ============================================================ */
const model = require("../models/customerModel");
const { httpError } = require("../middleware/errorHandler");

/* id จาก params ต้องเป็นเลขบวกเท่านั้น (กัน injection ตั้งแต่ต้นทาง) */
function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, "id ไม่ถูกต้อง");
  return id;
}

/* GET /api/customers?search=&status= */
async function list(req, res) {
  const rows = await model.findAll({
    search: String(req.query.search || "").trim(),
    status: String(req.query.status || "").trim()
  });
  res.json({ success: true, message: "ดึงข้อมูลสำเร็จ", data: rows, total: rows.length });
}

/* GET /api/customers/search?q= */
async function search(req, res) {
  const q = String(req.query.q || "").trim();
  if (!q) throw httpError(400, "ต้องระบุคำค้นหา q");
  const rows = await model.search(q);
  res.json({ success: true, message: "ค้นหาสำเร็จ", data: rows, total: rows.length });
}

/* GET /api/customers/:id */
async function getById(req, res) {
  const row = await model.findById(parseId(req.params.id));
  if (!row) throw httpError(404, "ไม่พบลูกค้าที่ระบุ");
  res.json({ success: true, message: "ดึงข้อมูลสำเร็จ", data: row });
}

/* POST /api/customers */
async function create(req, res) {
  const row = await model.create(req.body);
  res.status(201).json({ success: true, message: "บันทึกข้อมูลสำเร็จ", data: row });
}

/* PUT /api/customers/:id */
async function update(req, res) {
  const id = parseId(req.params.id);
  const exists = await model.findById(id);
  if (!exists) throw httpError(404, "ไม่พบลูกค้าที่ระบุ");
  const row = await model.update(id, req.body);
  res.json({ success: true, message: "แก้ไขข้อมูลสำเร็จ", data: row });
}

/* DELETE /api/customers/:id */
async function remove(req, res) {
  const id = parseId(req.params.id);
  const ok = await model.remove(id);
  if (!ok) throw httpError(404, "ไม่พบลูกค้าที่ระบุ");
  res.json({ success: true, message: "ลบข้อมูลสำเร็จ", data: { id } });
}

module.exports = { list, search, getById, create, update, remove };
