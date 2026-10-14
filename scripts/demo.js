/* ============================================================
   scripts/demo.js — ทดลองรัน backend โดยไม่ต้องติดตั้ง MySQL เอง
   รัน: npm run demo
   - เปิด MySQL ชั่วคราว (mysql-memory-server) + สร้างตาราง + เปิด server
   - ข้อมูลจะหายเมื่อกด Ctrl+C (เหมาะกับการทดลอง ไม่ใช่ใช้งานจริง)
   สำหรับใช้งานจริงให้ติดตั้ง MySQL แล้วทำตาม README.md
   ============================================================ */
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 5000;

(async () => {
  console.log("กำลังสตาร์ท MySQL ชั่วคราว (ครั้งแรกอาจดาวน์โหลดไบนารี) ...");
  const { createDB } = require("mysql-memory-server");
  const db = await createDB({ logLevel: "WARN" });
  console.log(`MySQL พร้อม (port ${db.port}) — กำลังสร้างตาราง...`);

  const env = {
    ...process.env,
    DB_HOST: "127.0.0.1",
    DB_PORT: String(db.port),
    DB_USER: db.username,
    DB_PASSWORD: "",
    DB_NAME: "crm_customers",
    PORT: String(PORT)
  };

  const init = spawn("node", ["sql/init.js"], { cwd: ROOT, env, shell: false });
  init.on("close", async (code) => {
    if (code !== 0) {
      console.error("สร้างตารางไม่สำเร็จ");
      await db.stop().catch(() => {});
      process.exit(1);
    }
    console.log(`เปิด backend ที่ http://localhost:${PORT} (กด Ctrl+C เพื่อหยุด)`);
    const server = spawn("node", ["server.js"], { cwd: ROOT, env, shell: false, stdio: "inherit" });

    const shutdown = async () => {
      server.kill();
      await db.stop().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    server.on("close", async () => {
      await db.stop().catch(() => {});
      process.exit(0);
    });
  });
})().catch((e) => {
  console.error("demo ไม่สำเร็จ:", e);
  process.exit(1);
});
