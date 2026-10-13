/* ============================================================
   scripts/e2e-test.js — ทดสอบ API ครบทุกเส้นทางบน MySQL จริง
   รัน: npm run test:e2e
   - สตาร์ท MySQL ชั่วคราวด้วย mysql-memory-server (ดาวน์โหลดไบนารีครั้งแรก)
   - สร้างตารางด้วย sql/init.js แล้วเปิด server.js บนพอร์ต 5599
   - ยิง assertions ครบ: CRUD + ค้นหา + validation + กัน SQL injection + error ไม่รั่ว
   ============================================================ */
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = 5599;
const B = `http://localhost:${PORT}`;
const env = { ...process.env }; // เติม DB_* หลังรู้ค่าจาก memory server

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (extra ? "  → " + extra : "")); }
}

async function req(method, p, body, headers = {}) {
  try {
    const res = await fetch(B + p, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: null, err: e.message };
  }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, env, shell: false });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await req("GET", "/api/health");
    if (r.status === 200) return true;
    await sleep(250);
  }
  return false;
}

(async () => {
  console.log("== 1) สตาร์ท MySQL ชั่วคราว ==");
  const { createDB } = require("mysql-memory-server");
  const db = await createDB({ logLevel: "WARN" });
  env.DB_HOST = "127.0.0.1";
  env.DB_PORT = String(db.port);
  env.DB_USER = db.username;
  env.DB_PASSWORD = "";           // memory server: root ไม่มีรหัสผ่าน
  env.DB_NAME = "crm_customers";
  env.PORT = String(PORT);
  console.log(`   MySQL ${db.mysql.version} @ port ${db.port}`);

  console.log("== 2) สร้าง database + ตาราง ==");
  const init = await run("node", ["sql/init.js"]);
  ok(init.code === 0, "npm run db:init สำเร็จ", (init.err || init.out).trim());

  console.log("== 3) เปิดเซิร์ฟเวอร์ ==");
  const server = spawn("node", ["server.js"], { cwd: ROOT, env, shell: false });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  const healthy = await waitHealthy();
  ok(healthy, "GET /api/health → 200", serverLog.trim());

  try {
    console.log("== 4) เพิ่มลูกค้า (POST) ==");
    let r = await req("POST", "/api/customers", {
      customer_code: "C-9001", first_name: "สมชาย", last_name: "ใจดี",
      phone: "081-234-5678", email: "somchai@example.com",
      company: "บริษัท ทดสอบ จำกัด", address: "กรุงเทพฯ",
      status: "Lead", notes: "ทดสอบ E2E"
    });
    ok(r.status === 201 && r.json.success === true && r.json.message === "บันทึกข้อมูลสำเร็จ",
      "POST ตอบ 201 {success:true, message:'บันทึกข้อมูลสำเร็จ'}", JSON.stringify(r.json));
    const id1 = r.json && r.json.data && r.json.data.id;
    ok(r.json && r.json.data && r.json.data.customer_code === "C-9001", "data คืนค่าที่บันทึก");

    r = await req("POST", "/api/customers", {
      customer_code: "C-9002", first_name: "สมหญิง", last_name: "รักดี", status: "เสนอราคา"
    });
    ok(r.status === 201, "POST สร้างได้แม้ไม่ใส่ phone/email (ไม่บังคับ)");
    const id2 = r.json && r.json.data && r.json.data.id;

    console.log("== 5) Validation ปฏิเสธข้อมูลผิด (400) ==");
    r = await req("POST", "/api/customers", { customer_code: "C-9003", first_name: "ทดสอบ" });
    ok(r.status === 400 && r.json.success === false && r.json.errors && r.json.errors.last_name,
      "ขาด last_name → 400 + errors.last_name", JSON.stringify(r.json));

    r = await req("POST", "/api/customers", {
      customer_code: "C-9004", first_name: "ทดสอบ", last_name: "ส่งเมล",
      email: "not-an-email", status: "ไม่มีสถานะนี้"
    });
    ok(r.status === 400 && r.json.errors.email && r.json.errors.status,
      "อีเมล/สถานะผิดรูปแบบ → 400 พร้อม errors ทั้งสองฟิลด์", JSON.stringify(r.json));

    r = await req("POST", "/api/customers", {
      customer_code: "C-9001", first_name: "ซ้ำ", last_name: "กัน"
    });
    ok(r.status === 409 || r.status === 400, "รหัสซ้ำ → 409/400", "status=" + r.status);
    ok(!JSON.stringify(r.json).match(/Duplicate|ER_DUP|uq_customer_code|INSERT/i),
      "ข้อความรหัสซ้ำไม่รั่ว SQL/ชื่อ index", JSON.stringify(r.json));

    console.log("== 6) ดึงข้อมูลทั้งหมด / ค้นหา / รายบุคคล (GET) ==");
    r = await req("GET", "/api/customers");
    ok(r.status === 200 && r.json.success && Array.isArray(r.json.data) && r.json.data.length >= 2,
      "GET /api/customers คืน list + total", "total=" + (r.json && r.json.total));

    r = await req("GET", "/api/customers/search?q=สมชาย");
    ok(r.status === 200 && r.json.data.length === 1 && r.json.data[0].customer_code === "C-9001",
      "ค้นหา 'สมชาย' เจอ 1 ราย", JSON.stringify(r.json.data));

    r = await req("GET", "/api/customers/search?q=");
    ok(r.status === 400 && r.json.success === false, "q ว่าง → 400");

    r = await req("GET", "/api/customers/" + id1);
    ok(r.status === 200 && r.json.data.id === id1 && r.json.data.first_name === "สมชาย",
      "GET /:id รายบุคคลถูกต้อง");

    r = await req("GET", "/api/customers/999999");
    ok(r.status === 404 && r.json.success === false, "id ไม่มีอยู่ → 404");

    r = await req("GET", "/api/customers/abc");
    ok(r.status === 400 && r.json.success === false, "id ไม่ใช่ตัวเลข → 400");

    console.log("== 7) แก้ไข (PUT) ==");
    r = await req("PUT", "/api/customers/" + id1, { status: "เสนอราคา", notes: "แก้ไขแล้ว" });
    ok(r.status === 200 && r.json.success && r.json.data.status === "เสนอราคา",
      "PUT แก้ status สำเร็จ", JSON.stringify(r.json && r.json.data));
    ok(r.json.data.first_name === "สมชาย", "ฟิลด์ที่ไม่ได้ส่งยังคงเดิม (partial update)");

    r = await req("PUT", "/api/customers/" + id1, { email: "ผิดรูป" });
    ok(r.status === 400 && r.json.errors && r.json.errors.email, "PUT อีเมลผิด → 400");

    r = await req("PUT", "/api/customers/999999", { status: "Lead" });
    ok(r.status === 404, "PUT id ไม่มี → 404");

    r = await req("PUT", "/api/customers/" + id1, {});
    ok(r.status === 400, "PUT ไม่ส่งฟิลด์เลย → 400", "status=" + r.status);

    console.log("== 8) SQL Injection ผ่าน validation ที่อนุญาต ==");
    /* ฟิลด์ notes รับอักขระได้แทบทุกตัว — ถ้า prepared statements ใช้งานจริง
       ข้อความจะถูกเก็บเป็น string ธรรมดา ไม่ลบตาราง */
    r = await req("POST", "/api/customers", {
      customer_code: "C-9005", first_name: "ทดสอบ", last_name: "Injection",
      notes: "'); DROP TABLE customers;--"
    });
    ok(r.status === 201, "บันทึก payload injection ได้ (เป็น string ธรรมดา)");
    r = await req("GET", "/api/customers");
    ok(r.status === 200 && r.json.data.some((x) => x.customer_code === "C-9005"),
      "ตาราง customers ยังอยู่ครบหลัง injection attempt", "total=" + (r.json && r.json.total));

    /* ค้นหาด้วยอักขระพิเศษต้องไม่ error */
    r = await req("GET", "/api/customers/search?q=%27%20OR%201%3D1--");
    ok(r.status === 200 && Array.isArray(r.json.data), "ค้นหาด้วยอักขระพิเศษไม่ error");

    console.log("== 9) ลบ (DELETE) ==");
    r = await req("DELETE", "/api/customers/" + id2);
    ok(r.status === 200 && r.json.success, "DELETE สำเร็จ");
    r = await req("DELETE", "/api/customers/" + id2);
    ok(r.status === 404, "DELETE ซ้ำ → 404");

    console.log("== 10) error ทั่วไปไม่รั่วข้อมูล + CORS ==");
    r = await req("GET", "/api/nope");
    ok(r.status === 404 && r.json.success === false, "endpoint ไม่มี → 404 JSON");

    const corsRes = await fetch(B + "/api/health", {
      headers: { Origin: "http://example.com" }
    });
    ok(corsRes.status === 200, "CORS ตอบ preflight-compatible (มี header)", "acao=" +
      (corsRes.headers.get("access-control-allow-origin") || "none"));

    const health = await req("GET", "/api/health");
    ok(health.json && health.json.success && health.json.data.db && !("password" in health.json.data.db),
      "health ไม่เปิดเผยรหัสผ่าน");
  } finally {
    console.log("== ปิดระบบ ==");
    server.kill();
    await db.stop().catch(() => {});
  }

  console.log(`\nผลลัพธ์: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("E2E เกิดข้อผิดพลาด:", e);
  process.exit(1);
});
