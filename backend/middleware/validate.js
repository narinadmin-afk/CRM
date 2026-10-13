/* ============================================================
   middleware/validate.js — ตรวจสอบข้อมูลก่อนบันทึกลง Database
   - validateCreate: บังคับครบทุกฟิลด์ required + รูปแบบถูกต้อง
   - validateUpdate: ตรวจสอบเฉพาะฟิลด์ที่ส่งมา (partial update)
   - ถ้าไม่ผ่าน → ตอบ 400 { success:false, message, errors:{field:msg} }
   ============================================================ */
const { STATUS_OPTIONS, CUSTOMER_COLUMNS, LIMITS } = require("../config/constants");

/* ---------- ตัวช่วย ---------- */
const asStr = (v) => (typeof v === "string" ? v.trim() : v);

const RE = {
  code: /^[A-Za-z0-9_-]{2,20}$/,
  phone: /^[0-9+\-() ]{7,20}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
};

/** ตรวจสอบฟิลด์เดียว — คืนข้อความ error หรือ null ถ้าผ่าน */
function checkField(field, raw) {
  const v = asStr(raw);
  const max = LIMITS[field];

  switch (field) {
    case "customer_code":
      if (v === undefined || v === null || v === "") return "ต้องระบุรหัสลูกค้า";
      if (!RE.code.test(v)) return "รูปแบบไม่ถูกต้อง (ใช้ a-z A-Z 0-9 - _ ยาว 2–20 ตัวอักษร)";
      return null;

    case "first_name":
    case "last_name":
      if (v === undefined || v === null || v === "") return "ต้องระบุ" + (field === "first_name" ? "ชื่อ" : "นามสกุล");
      if (v.length > max) return `ยาวเกิน ${max} ตัวอักษร`;
      return null;

    case "phone":
      if (v === undefined || v === null || v === "") return null; // ไม่บังคับ
      if (!RE.phone.test(v)) return "รูปแบบเบอร์โทรไม่ถูกต้อง (เช่น 081-234-5678)";
      return null;

    case "email":
      if (v === undefined || v === null || v === "") return null; // ไม่บังคับ
      if (!RE.email.test(v)) return "รูปแบบอีเมลไม่ถูกต้อง";
      if (v.length > max) return `ยาวเกิน ${max} ตัวอักษร`;
      return null;

    case "company":
    case "address":
    case "notes":
      if (v === undefined || v === null || v === "") return null; // ไม่บังคับ
      if (v.length > max) return `ยาวเกิน ${max} ตัวอักษร`;
      return null;

    case "status":
      if (v === undefined || v === null || v === "") return null; // default = Lead
      if (!STATUS_OPTIONS.includes(v)) return "สถานะต้องเป็นหนึ่งใน: " + STATUS_OPTIONS.join(", ");
      return null;

    default:
      return "ฟิลด์ไม่รู้จัก";
  }
}

/** ตรวจสอบ object รวม → { errors, clean } */
function validateCustomer(body, { partial = false } = {}) {
  const errors = {};
  const clean = {};
  const src = body && typeof body === "object" ? body : {};

  const fields = partial
    ? CUSTOMER_COLUMNS.filter((c) => src[c] !== undefined) // เฉพาะฟิลด์ที่ส่งมา
    : CUSTOMER_COLUMNS;

  if (partial && fields.length === 0) {
    errors._ = "ไม่มีข้อมูลที่ต้องแก้ไข";
  }

  for (const field of fields) {
    const msg = checkField(field, src[field]);
    if (msg) errors[field] = msg;
    else {
      const v = asStr(src[field]);
      clean[field] = v === undefined || v === null || v === "" ? null : v;
    }
  }

  /* ค่าเริ่มต้นตอนสร้างใหม่ */
  if (!partial) {
    if (!clean.status) clean.status = "Lead";
  } else if (clean.status === null) {
    /* status ห้ามเป็น NULL (คอลัมน์ NOT NULL) — ส่งว่าง/null มา = ไม่แก้ไข */
    delete clean.status;
  }

  return { errors, clean };
}

/* ---------- Express middleware ---------- */
function validateCreate(req, res, next) {
  const { errors, clean } = validateCustomer(req.body, { partial: false });
  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, message: "ข้อมูลไม่ถูกต้อง", errors });
  }
  req.body = clean;
  next();
}

function validateUpdate(req, res, next) {
  const { errors, clean } = validateCustomer(req.body, { partial: true });
  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, message: "ข้อมูลไม่ถูกต้อง", errors });
  }
  req.body = clean;
  next();
}

module.exports = { validateCreate, validateUpdate, validateCustomer };
