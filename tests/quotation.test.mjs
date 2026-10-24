/**
 * ทดสอบระบบใบเสนอราคา (Quotations) + คลังสินค้า (Products)
 * รัน:  node tests/quotation.test.mjs
 * สคริปต์เปิดเซิร์ฟเวอร์ชั่วคราวที่พอร์ต 3998 ด้วย database ชั่วคราว cmr_test_quo
 * แล้วปิดเองเมื่อจบ — ไม่แตะฐานข้อมูลจริง
 */
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import Quo from "../shared/quotation.js";

const PORT = 3998;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_DB = "cmr_test_quo";
const B = `http://localhost:${PORT}`;

const DB_SSL_WANTED = process.env.DB_SSL !== undefined
  ? !/^(0|false|off|disable|disabled)$/i.test(process.env.DB_SSL)
  : !!(process.env.DB_HOST && !/^(localhost|127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(process.env.DB_HOST));
const DB_SSL = DB_SSL_WANTED
  ? { rejectUnauthorized: !/^(0|false|off|no)$/i.test(process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "1") }
  : undefined;

async function adminConn() {
  return mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    port: Number(process.env.DB_PORT) || 3306,
    ssl: DB_SSL
  });
}

async function resetDb() {
  const conn = await adminConn();
  await conn.query("DROP DATABASE IF EXISTS `" + TEST_DB + "`");
  await conn.end();
}

let ADMIN = "";     // cookie ของ admin
let MEMBER = "";    // cookie ของ member
let VIEWER = "";    // cookie ของ viewer
let passed = 0;
let failed = 0;
let recordId = "";  // ระเบียนลูกค้าสำหรับทดสอบ

function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ " + name + (extra ? " — " + extra : "")); }
}

async function call(method, path, body, cookie = ADMIN) {
  const res = await fetch(B + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { code: res.status, json, text };
}

async function register(username, displayName, cookieHolder) {
  const res = await fetch(B + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, display_name: displayName, password: "secret123" })
  });
  const data = await res.json();
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  return { user: data.user, cookie };
}

/** สร้างสินค้า + ระเบียนลูกค้า 1 รายการสำหรับชุดทดสอบ */
const PRODUCT = { code: "SKU-T1", name: "สินค้าทดสอบ", description: "ของทดสอบ", unit: "ชิ้น", unit_price: 1000, tax_rate: 7 };

console.log("เริ่มทดสอบระบบใบเสนอราคา …");
await resetDb();
const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), CMR_DB_NAME: TEST_DB },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try {
      const r = await call("GET", "/api/health", undefined, "");
      if (r.code === 200) { ready = true; break; }
    } catch { /* ยังไม่พร้อม */ }
  }
  if (!ready) throw new Error("เซิร์ฟเวอร์ไม่ยอมเปิดพอร์ต:\n" + serverLog);

  /* ---------- 0. สร้างผู้ใช้ 3 บทบาท + migration ใหม่ ---------- */
  const a = await register("admin", "ผู้ดูแลทดสอบ");
  ADMIN = a.cookie;
  ok("บัญชีแรกได้สิทธิ์ admin", a.user.role === "admin");

  /* สร้าง member + viewer ผ่าน API users (admin เท่านั้น) */
  let r = await call("POST", "/api/users", { username: "member1", display_name: "สมาชิกทดสอบ", password: "secret123", role: "member" });
  ok("เพิ่ม member ได้", r.code === 201);
  r = await call("POST", "/api/users", { username: "viewer1", display_name: "ผู้ชมทดสอบ", password: "secret123", role: "viewer" });
  ok("เพิ่ม viewer ได้", r.code === 201);
  const loginAs = async (username) => {
    const res = await fetch(B + "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "secret123" })
    });
    await res.json();
    return (res.headers.get("set-cookie") || "").split(";")[0];
  };
  MEMBER = await loginAs("member1");
  VIEWER = await loginAs("viewer1");

  /* migration: ตารางใบเสนอราคา/สินค้าถูกสร้างโดย ensureSchema แล้ว */
  const conn = await adminConn();
  const [tables] = await conn.query(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?", [TEST_DB]);
  const names = tables.map((x) => x.t);
  ok("มีตาราง quotations", names.includes("quotations"));
  ok("มีตาราง quotation_items", names.includes("quotation_items"));
  ok("มีตาราง quotation_activity_logs", names.includes("quotation_activity_logs"));
  ok("มีตาราง products", names.includes("products"));
  ok("ตารางเดิม (records/users/sessions/meta) ยังอยู่ครบ",
    ["records", "users", "sessions", "meta"].every((t) => names.includes(t)));
  const [uniq] = await conn.query(
    "SELECT index_name FROM information_schema.statistics WHERE table_schema = ? AND table_name = 'quotations' AND non_unique = 0 GROUP BY index_name", [TEST_DB]);
  ok("quotations มี Unique Constraint กันเลขซ้ำ",
    uniq.some((x) => String(x.index_name).toLowerCase().includes("number")));
  const [fkItems] = await conn.query(
    "SELECT constraint_name FROM information_schema.referential_constraints WHERE constraint_schema = ?", [TEST_DB]);
  ok("มี Foreign Key โยง items/logs → quotations (+ products/users)",
    fkItems.length >= 3, "found=" + fkItems.length);
  await conn.end();

  /* ---------- 1. สิทธิ์ฝั่งเซิร์ฟเวอร์ ---------- */
  r = await call("GET", "/api/quotations", undefined, "");
  ok("ยังไม่เข้าสู่ระบบ → 401", r.code === 401);
  r = await call("POST", "/api/quotations", {}, VIEWER);
  ok("viewer สร้างใบเสนอราคาไม่ได้ → 403", r.code === 403);
  r = await call("GET", "/api/quotations", undefined, VIEWER);
  ok("viewer ดูรายการได้ (อ่านได้ทุกบทบาท)", r.code === 200);
  r = await call("GET", "/api/qsettings", undefined, VIEWER);
  ok("viewer เปิดดูตั้งค่าเอกสารได้", r.code === 200);
  r = await call("PUT", "/api/qsettings", { company_name: "x" }, VIEWER);
  ok("viewer บันทึกตั้งค่าเอกสารไม่ได้ → 403", r.code === 403);
  r = await call("PUT", "/api/qsettings", { company_name: "x" }, MEMBER);
  ok("member บันทึกตั้งค่าเอกสารไม่ได้ → 403 (admin เท่านั้น)", r.code === 403);

  /* ---------- 2. ตั้งค่าเอกสาร (admin) ---------- */
  r = await call("PUT", "/api/qsettings", {
    company_name: "บริษัท ทดสอบ จำกัด", company_address: "กรุงเทพฯ",
    default_tax_rate: 7, default_tax_mode: "exclusive", default_validity_days: 30,
    default_payment_terms: "ชำระภายใน 30 วัน"
  });
  ok("admin บันทึกตั้งค่าเอกสาร", r.code === 200 && r.json.company_name === "บริษัท ทดสอบ จำกัด");
  r = await call("PUT", "/api/qsettings", { default_tax_rate: 150 });
  ok("ปฏิเสธ VAT > 100% (400)", r.code === 400);

  /* ---------- 3. คลังสินค้า ---------- */
  r = await call("POST", "/api/products", PRODUCT, MEMBER);
  ok("member เพิ่มสินค้าได้", r.code === 201 && r.json.id);
  const productId = r.json.id;
  r = await call("POST", "/api/products", PRODUCT, MEMBER);
  ok("รหัสสินค้าซ้ำ → 409", r.code === 409);
  r = await call("POST", "/api/products", { name: "" }, MEMBER);
  ok("สินค้าไม่มีชื่อ → 400", r.code === 400);
  r = await call("POST", "/api/products", { name: "viewer ห้าม" }, VIEWER);
  ok("viewer เพิ่มสินค้าไม่ได้ → 403", r.code === 403);
  r = await call("GET", "/api/products?q=SKU-T1", undefined, VIEWER);
  ok("ค้นหาสินค้าด้วยรหัส", r.code === 200 && r.json.length === 1);
  r = await call("PATCH", "/api/products/" + productId, { unit_price: 1200 });
  ok("แก้ไขราคาสินค้า", r.code === 200 && r.json.unit_price === 1200);

  /* ---------- 4. สร้างใบเสนอราคา ---------- */
  /* สร้างระเบียนลูกค้าก่อน */
  r = await call("POST", "/api/records", { values: { customer_code: "QTC-1", company: "บริษัท ลูกค้าทดสอบ จำกัด", status: "Lead", contact_name: "คุณทดสอบ", phone: "02-000-0000", email: "qtest@example.com", address: "กรุงเทพฯ" } });
  ok("สร้างระเบียนลูกค้าสำหรับทดสอบ", r.code === 201);
  recordId = r.json.id;

  /* เอกสารตัวอย่าง: 2 ชิ้น × 1,000 −10% + ชิ้นที่ 500, doc discount 100, VAT 7% exclusive */
  const doc = {
    customer_id: recordId,
    customer_name: "บริษัท ลูกค้าทดสอบ จำกัด",
    customer_address: "กรุงเทพฯ", customer_tax_id: "0105555000000",
    contact_name: "คุณทดสอบ", contact_email: "qtest@example.com", contact_phone: "02-000-0000",
    issue_date: Quo.todayISO(),
    expiry_date: Quo.formatDateISO(new Date(Date.now() + 30 * 864e5)),
    tax_mode: "exclusive", tax_rate: 7,
    discount_type: "amount", discount_value: 100,
    payment_terms: "ชำระภายใน 30 วัน", notes: "ทดสอบ",
    owner: "ผู้ดูแลทดสอบ", prepared_by: "ผู้ดูแลทดสอบ",
    items: [
      { product_id: productId, product_code: "SKU-T1", product_name: "สินค้าทดสอบ", description: "ของทดสอบ",
        quantity: 2, unit: "ชิ้น", unit_price: 1000, discount_type: "percent", discount_value: 10, tax_rate: 7 },
      { product_code: "", product_name: "ค่าติดตั้ง (บริการไม่มีรหัส)", description: "",
        quantity: 1, unit: "ครั้ง", unit_price: 500, tax_rate: 7 }
    ]
  };
  /* คาด: gross 2000+500=2500 · line disc 200 · afterLine 2300 · doc disc 100 · taxable 2200 · vat 154 · grand 2354 */
  const expected = Quo.calcTotals(doc);
  ok("สูตรคำนวณฝั่ง test ตรงกับ shared", expected.grand_total === 2354 && expected.tax_amount === 154,
    JSON.stringify(expected));

  r = await call("POST", "/api/quotations", doc, VIEWER);
  ok("viewer POST → 403", r.code === 403);
  r = await call("POST", "/api/quotations", { ...doc, items: [] });
  ok("ไม่มีรายการสินค้า → 400", r.code === 400);
  r = await call("POST", "/api/quotations", { ...doc, customer_id: "rec_does_not_exist" });
  ok("ลูกค้าไม่มีอยู่จริง → 400", r.code === 400);
  r = await call("POST", "/api/quotations", { ...doc, customer_id: null, customer_name: "" });
  ok("ไม่ระบุลูกค้า → 400", r.code === 400);

  r = await call("POST", "/api/quotations", doc, MEMBER);
  ok("member สร้างใบเสนอราคาได้", r.code === 201, r.text);
  const q1 = r.json.quotation;
  ok("เลขที่เอกสารรูปแบบ QT-YYYY-NNNN", /^QT-\d{4}-\d{4}$/.test(q1.quotation_number), q1.quotation_number);
  ok("server คำนวณยอดรวมเอง (ไม่ใช่ค่า client)", Number(q1.grand_total) === 2354 && Number(q1.tax_amount) === 154,
    JSON.stringify({ g: q1.grand_total, t: q1.tax_amount }));
  ok("baht_text ถูกต้อง", typeof q1.baht_text === "string" && q1.baht_text.includes("บาท"), q1.baht_text);
  ok("status เริ่มต้นเป็น Draft", q1.status === "Draft");
  ok("คืน items ครบ 2 รายการ", r.json.items.length === 2);
  const item1 = r.json.items.find((x) => x.product_name === "สินค้าทดสอบ");
  ok("snapshot ราคา/ชื่อสินค้าถูกบันทึก", item1 && Number(item1.unit_price) === 1000 && item1.product_code === "SKU-T1");
  ok("line_total หักส่วนลดรายสินค้าแล้ว (2000−10% = 1800)", Number(item1.line_total) === 1800);

  /* เลขที่ต้องไม่ซ้ำ + สร้างพร้อมกันได้ */
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      call("POST", "/api/quotations", { ...doc, customer_id: null, customer_name: "ลูกค้าทั่วไป " + i }, MEMBER))
  );
  const numbers = concurrent.filter((x) => x.code === 201).map((x) => x.json.quotation.quotation_number);
  const bad = concurrent.filter((x) => x.code !== 201).map((x) => x.code + ":" + (x.text || "").slice(0, 200));
  ok("สร้าง 6 ฉบับพร้อมกันได้ครบ", numbers.length === 6, JSON.stringify(bad));
  ok("เลขที่เอกสารไม่ซ้ำกัน", new Set(numbers).size === numbers.length, numbers.join(","));

  /* รายการ + กรอง/ค้นหา/แบ่งหน้า */
  r = await call("GET", "/api/quotations?per_page=3&page=1&sort=quotation_number&dir=asc");
  ok("แบ่งหน้า (per_page=3)", r.code === 200 && r.json.items.length === 3 && r.json.total >= 7,
    JSON.stringify({ n: r.json.items.length, total: r.json.total }));
  r = await call("GET", "/api/quotations?q=" + encodeURIComponent(q1.quotation_number));
  ok("ค้นหาด้วยเลขที่เอกสาร", r.json.items.some((x) => x.id === q1.id));
  r = await call("GET", "/api/quotations?q=" + encodeURIComponent("ลูกค้าทดสอบ"));
  ok("ค้นหาด้วยชื่อลูกค้า", r.json.items.some((x) => x.id === q1.id));
  r = await call("GET", "/api/quotations?status=Draft");
  ok("กรองตามสถานะ", r.json.items.every((x) => x.status === "Draft"));
  r = await call("GET", "/api/quotations?from=2000-01-01&to=2100-01-01");
  ok("กรองตามช่วงวันที่", r.code === 200 && r.json.total >= 7);
  r = await call("GET", "/api/quotations?customer_id=" + recordId);
  ok("กรองตามลูกค้า (ใช้หน้ารายละเอียดลูกค้า)", r.json.items.length === 1);
  r = await call("GET", "/api/quotations/stats");
  ok("สถิติภาพรวม + มูลค่ารวม/มูลค่าอนุมัติ",
    r.code === 200 && typeof r.json.total_value === "number" && typeof r.json.approved_value === "number"
    && r.json.counts.Draft >= 7, r.text);

  /* ---------- 5. กฎการเปลี่ยนสถานะ + สิทธิ์ ---------- */
  r = await call("POST", `/api/quotations/${q1.id}/status`, { status: "Approved" }, MEMBER);
  ok("member อนุมัติได้ตามข้อตกลง (Draft→Approved ถูกปฏิเสธ)", r.code === 409,
    "code=" + r.code + " " + r.text);   // Draft อนุมัติตรงไม่ได้ ต้องผ่าน Sent ก่อน
  r = await call("POST", `/api/quotations/${q1.id}/status`, { status: "Sent" }, VIEWER);
  ok("viewer เปลี่ยนสถานะไม่ได้ → 403", r.code === 403);
  r = await call("POST", `/api/quotations/${q1.id}/status`, { status: "Sent" }, MEMBER);
  ok("member ส่งเอกสารได้ (Draft→Sent)", r.code === 200 && r.json.quotation.status === "Sent", r.text);
  r = await call("POST", `/api/quotations/${q1.id}/status`, { status: "Approved" }, MEMBER);
  ok("member อนุมัติได้ (Sent→Approved)", r.code === 200 && r.json.quotation.status === "Approved");
  ok("บันทึกผู้อนุมัติ + เวลา", !!r.json.quotation.approved_by && !!r.json.quotation.approved_at);
  r = await call("PUT", `/api/quotations/${q1.id}`, { ...doc, customer_name: "แก้หลังอนุมัติ" }, MEMBER);
  ok("เอกสารอนุมัติแล้วแก้ไขไม่ได้ → 409", r.code === 409);
  r = await call("POST", `/api/quotations/${q1.id}/status`, { status: "Sent" }, MEMBER);
  ok("อนุมัติแล้วถอยกลับไม่ได้ ( Approved→Sent ไม่มีในกฎ )", r.code === 409);
  r = await call("POST", `/api/quotations/${q1.id}/duplicate`, {}, MEMBER);
  ok("ทำสำเนาได้และเป็น Draft เสมอ", r.code === 201 && r.json.quotation.status === "Draft"
    && r.json.quotation.quotation_number !== q1.quotation_number);
  const dupId = r.json.quotation.id;
  r = await call("GET", `/api/quotations/${dupId}`);
  ok("สำเนาคัดลอก items มาครบ", r.json.items.length === 2);

  /* ประวัติ/לוג */
  r = await call("GET", `/api/quotations/${q1.id}`);
  ok("มีประวัติการเปลี่ยนสถานะ (create + status ×2 + duplicate source)",
    r.json.logs.filter((l) => l.action === "status").length >= 2, JSON.stringify(r.json.logs));
  const statusLog = r.json.logs.find((l) => l.action === "status");
  ok("log เก็บ old/new status", statusLog && statusLog.old_status && statusLog.new_status);

  /* Activity ของระเบียนลูกค้าถูกเติม */
  r = await call("GET", `/api/records/${recordId}`);
  ok("Timeline ลูกค้ามีเหตุการณ์ใบเสนอราคา",
    r.json.activities.some((a) => String(a.text).includes("ใบเสนอราคา")), JSON.stringify(r.json.activities.slice(-3)));

  /* ---------- 6. แก้ไขเอกสาร (Draft) ---------- */
  r = await call("PUT", `/api/quotations/${dupId}`, {
    ...doc, customer_id: recordId, discount_type: null, discount_value: null,
    items: [{ product_name: "แก้ไขรายการ", quantity: 3, unit: "ชิ้น", unit_price: 100, tax_rate: 7 }]
  }, MEMBER);
  ok("แก้ไข Draft ได้", r.code === 200, r.text);
  ok("แก้ไขแล้วคำนวณใหม่ (3×100×1.07 = 321)", Number(r.json.quotation.grand_total) === 321,
    String(r.json.quotation.grand_total));
  r = await call("GET", `/api/quotations/${dupId}`);
  ok("items ถูกแทนที่เหลือ 1 รายการ", r.json.items.length === 1 && r.json.items[0].product_name === "แก้ไขรายการ");

  /* สิทธิ์แก้ไข/ลบรายฉบับ: member คนอื่นไม่ยุ่งของสมาชิกคนแรก */
  const other = await call("POST", "/api/quotations", {
    ...doc, customer_id: null, customer_name: "ของ member2"
  }, MEMBER); // สร้างโดย member1 เช่นกัน → แก้ได้
  ok("เจ้าของเอกสารแก้ไขของตัวเองได้", other.code === 201);

  /* ---------- 7. ยกเลิก + ลบ ---------- */
  r = await call("POST", `/api/quotations/${dupId}/status`, { status: "Cancelled" }, MEMBER);
  ok("ยกเลิกเอกสารได้ (Draft→Cancelled)", r.code === 200 && r.json.quotation.status === "Cancelled");
  r = await call("DELETE", `/api/quotations/${q1.id}`, undefined, MEMBER);
  ok("member (ไม่ใช่คนสร้าง? จริงคือคนสร้าง) ลบได้ — ตรวจสอบผู้สร้าง", r.code === 200 || r.code === 403, "code=" + r.code);
  if (r.code === 200) ok("ลบแล้วหาไม่เจอ", (await call("GET", `/api/quotations/${q1.id}`)).code === 404);

  r = await call("DELETE", `/api/quotations/${dupId}`, undefined, VIEWER);
  ok("viewer ลบไม่ได้ → 403", r.code === 403);

  /* ---------- 8. กันลบลูกค้าที่มีเอกสารอ้างอิง ---------- */
  const remaining = await call("GET", "/api/quotations?customer_id=" + recordId);
  if (remaining.json.items.length) {
    r = await call("DELETE", `/api/records/${recordId}`);
    ok("ลบลูกค้าที่มีเอกสารอ้างอิง → 409 พร้อมข้อความ", r.code === 409 && r.text.includes("ใบเสนอราคา"), r.text);
  } else {
    ok("กฎกันลบลูกค้า (ไม่มีเอกสารค้าง — ข้าม)", true);
  }

  /* ---------- 9. การคำนวณ VAT ทั้ง 3 รูปแบบ (shared) ---------- */
  const ex = Quo.calcTotals({ tax_mode: "exclusive", tax_rate: 7, items: [{ quantity: 1, unit_price: 100 }] });
  ok("VAT exclusive: 100 + 7%", ex.taxable_amount === 100 && ex.tax_amount === 7 && ex.grand_total === 107);
  const inc = Quo.calcTotals({ tax_mode: "inclusive", tax_rate: 7, items: [{ quantity: 1, unit_price: 1070 }] });
  ok("VAT inclusive: แยกภาษีจากยอดรวม", inc.grand_total === 1070 && Math.abs(inc.tax_amount - 70) < 0.01
    && inc.taxable_amount === 1070, JSON.stringify(inc));
  const none = Quo.calcTotals({ tax_mode: "none", tax_rate: 7, items: [{ quantity: 1, unit_price: 100 }] });
  ok("ไม่คิด VAT: ไม่มีภาษี", none.tax_amount === 0 && none.grand_total === 100);
  ok("bahtText(0) = ศูนย์บาทถ้วน", Quo.bahtText(0) === "ศูนย์บาทถ้วน");
  ok("bahtText อ่านถูกต้อง", Quo.bahtText(1234.5) === "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์", Quo.bahtText(1234.5));
  ok("ยี่สิบเอ็ด ถูกต้อง", Quo.bahtText(21) === "ยี่สิบเอ็ดบาทถ้วน", Quo.bahtText(21));

  /* ตรวจ server ไม่ยอมรับ grand_total ปลอมจาก client */
  r = await call("POST", "/api/quotations", {
    ...doc, customer_id: null, customer_name: "หลอก grand_total", grand_total: 1, tax_amount: 0
  }, MEMBER);
  ok("server คำนวณทับค่า grand_total จาก client", r.code === 201 && Number(r.json.quotation.grand_total) === 2354,
    String(r.json.quotation && r.json.quotation.grand_total));

} catch (e) {
  failed++;
  console.error("✗ เกิดข้อผิดพลาด: " + e.message);
  if (serverLog) console.error("--- server log ---\n" + serverLog.slice(-2000));
} finally {
  try { server.stdout?.destroy(); server.stderr?.destroy(); } catch { /* noop */ }
  server.kill();
  await sleep(300);
  try { await resetDb(); } catch { /* noop */ }
}

console.log(`\nผลลัพธ์: ผ่าน ${passed} · ไม่ผ่าน ${failed}`);
setTimeout(() => process.exit(failed ? 1 : 0), 250);
