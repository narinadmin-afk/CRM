/* ============================================================
   server.js — เซิร์ฟเวอร์ Backend ระบบ CRM (Express + MySQL)
   รัน: npm start  (อ่าน .env จากโฟลเดอร์นี้)
   ============================================================ */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { testConnection, dbInfo } = require("./config/db");
const customerRoutes = require("./routes/customerRoutes");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

/* ---------- CORS: อนุญาตเฉพาะ frontend ที่กำหนดใน .env (CLIENT_ORIGIN) ---------- */
const origin = process.env.CLIENT_ORIGIN;
app.use(cors(origin ? { origin } : {}));

/* ---------- รับ body เป็น JSON (จำกัดขนาด กัน payload ใหญ่เกินจำเป็น) ---------- */
app.use(express.json({ limit: "100kb" }));

/* ---------- routes ---------- */
app.get("/api/health", (req, res) =>
  res.json({ success: true, message: "เซิร์ฟเวอร์ทำงานปกติ", data: { db: dbInfo() } })
);
app.use("/api/customers", customerRoutes);
app.use("/api", notFound);          // endpoint อื่นใน /api → 404 JSON
app.use(notFound);                  // นอก /api → 404 JSON

/* ---------- error handler กลาง (ต้องอยู่ท้ายสุด) ---------- */
app.use(errorHandler);

/* ---------- เริ่มเซิร์ฟเวอร์ (ตรวจ DB ก่อนเสมอ) ---------- */
(async () => {
  const ok = await testConnection();
  if (!ok) {
    console.error("[server] ยกเลิกการเริ่มเซิร์ฟเวอร์ เพราะเชื่อมต่อฐานข้อมูลไม่ได้");
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log("--------------------------------------------");
    console.log(`  Backend พร้อมใช้งาน  http://localhost:${PORT}`);
    console.log(`  ฐานข้อมูล: ${dbInfo().user}@${dbInfo().host}:${dbInfo().port}/${dbInfo().name}`);
    console.log("  API: /api/customers (ดูตัวอย่างที่ README.md)");
    console.log("--------------------------------------------");
  });
})();
