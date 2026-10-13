/* ============================================================
   config/constants.js — ค่าคงที่ที่ใช้ร่วมกัน (validation + model)
   ============================================================ */

/** สถานะลูกค้า — ตรงกับชุดสถานะของแอป CRM ฝั่ง Frontend (shared/seed.js) */
const STATUS_OPTIONS = [
  "Lead",
  "ติดต่อแล้ว",
  "เสนอราคา",
  "กำลังเจรจา",
  "ปิดการขาย",
  "ลูกค้าประจำ",
  "แพ้งาน"
];

/** คอลัมน์ข้อมูลลูกค้า (ไม่รวม id / created_at / updated_at ที่ระบบจัดการเอง)
 *  model จะอนุญาต INSERT/UPDATE เฉพาะคอลัมน์ใน whitelist นี้เท่านั้น
 *  → ชื่อคอลัมน์จากผู้ใช้ไม่มีทางหลุดเข้าไปใน SQL ได้ */
const CUSTOMER_COLUMNS = [
  "customer_code",
  "first_name",
  "last_name",
  "phone",
  "email",
  "company",
  "address",
  "status",
  "notes"
];

/** คอลัมน์ที่ SELECT กลับมา (whitelist + ระบบ) */
const CUSTOMER_SELECT = ["id", ...CUSTOMER_COLUMNS, "created_at", "updated_at"];

/** ข้อจำกัดความยาว (ตรงกับ schema.sql) */
const LIMITS = {
  customer_code: 20,
  first_name: 100,
  last_name: 100,
  phone: 20,
  email: 150,
  company: 150,
  address: 500,
  notes: 1000
};

module.exports = { STATUS_OPTIONS, CUSTOMER_COLUMNS, CUSTOMER_SELECT, LIMITS };
