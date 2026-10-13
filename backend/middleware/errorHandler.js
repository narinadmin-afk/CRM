/* ============================================================
   middleware/errorHandler.js — จัดการ Error กลาง
   - ฟิลด์ error จาก MySQL (เช่น duplicate, syntax) ถูกแปลงเป็น
     ข้อความภาษาไทยที่ปลอดภัย — ไม่ส่งรายละเอียด DB/SQL ออกไป
   - ข้อความเต็มบันทึกเฉพาะ console ฝั่งเซิร์ฟเวอร์เท่านั้น
   ============================================================ */

/** สร้าง HttpError พร้อมสถานะ (ใช้ใน controller: throw httpError(404, "...")) */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/* ---------- แปลง error ของ MySQL → ข้อความปลอดภัย ---------- */
function toSafeMessage(err) {
  switch (err.code) {
    case "ER_DUP_ENTRY":
      return "ข้อมูลซ้ำ: รหัสลูกค้านี้มีอยู่ในระบบแล้ว";
    case "ER_NO_SUCH_TABLE":
      return "ยังไม่มีตารางในฐานข้อมูล — รัน npm run db:init ก่อน";
    case "ER_BAD_FIELD_ERROR":
    case "ER_UNKNOWN_TABLE":
    case "ER_PARSE_ERROR":
    case "ER_SYNTAX_ERROR":
      return "เกิดข้อผิดพลาดจากฐานข้อมูล (ดูรายละเอียดที่ log ฝั่งเซิร์ฟเวอร์)";
    case "ECONNREFUSED":
    case "PROTOCOL_CONNECTION_LOST":
    case "ETIMEDOUT":
      return "ไม่สามารถเชื่อมต่อฐานข้อมูลได้";
    default:
      return "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง";
  }
}

/* ---------- 404 สำหรับ route ที่ไม่มี ---------- */
function notFound(req, res) {
  res.status(404).json({ success: false, message: "ไม่พบ endpoint ที่ร้องขอ" });
}

/* ---------- Error handler กลาง (express 4 รับ arg ครบ 4 ตัว) ---------- */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  /* error ของ MySQL → แปลงเป็นข้อความปลอดภัย + status ที่ถูกต้อง */
  if (err.code && err.code.startsWith("ER_")) {
    err.message = toSafeMessage(err);
    if (err.code === "ER_DUP_ENTRY") err.status = 409;
  }

  const status = err.status || 500;

  /* บันทึกรายละเอียดเต็มเฉพาะฝั่งเซิร์ฟเวอร์ */
  console.error(`[error] ${req.method} ${req.originalUrl} → ${status} ${err.code || ""} ${err.message}`);

  if (status >= 500 && !err.status) {
    /* error ที่ไม่คาดคิด — ไม่เปิดเผยรายละเอียด */
    return res.status(500).json({ success: false, message: toSafeMessage(err) });
  }

  /* error ที่ controller ตั้งใจโยน (404/400/409) — ใช้ข้อความที่เตรียมไว้ */
  res.status(status).json({ success: false, message: err.message || "คำขอไม่สำเร็จ" });
}

module.exports = { httpError, notFound, errorHandler };
