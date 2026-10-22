/* ตรวจว่า database ชื่ออะไรจริง ๆ และมีตารางไหนอยู่บ้าง (แยกปัญหา c-r-m vs c-m-r) */
const mysql = require("mysql2/promise");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, port: Number(process.env.DB_PORT) || 3306,
    connectTimeout: 8000
  });
  console.log("env.DB_NAME =", JSON.stringify(process.env.DB_NAME));
  const [dbs] = await c.query(
    "SELECT schema_name s, HEX(schema_name) h FROM information_schema.schemata " +
    "WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys','sakila','world')"
  );
  for (const d of dbs) console.log("db:", d.s, "| hex:", d.h);
  for (const d of dbs) {
    const [ts] = await c.query("SELECT table_name t, table_rows r FROM information_schema.tables WHERE table_schema = ?", [d.s]);
    console.log("  " + d.s + " →", ts.map((t) => t.t + "(" + t.r + ")").join(", ") || "(no tables)");
  }
  await c.end();
})().catch((e) => { console.error("ERR", e.code || "", e.message); process.exit(1); });
