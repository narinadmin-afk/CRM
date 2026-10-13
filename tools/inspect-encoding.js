const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/cmr.sqlite", { readOnly: true });

const sch = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='schema'").get().value);
console.log("== schema field options (stored in DB) ==");
for (const f of sch.fields) {
  if (f.options) console.log(" ", f.key, JSON.stringify(f.options));
}

console.log("\n== distinct record values ==");
for (const k of ["status", "owner", "source", "priority", "industry"]) {
  const rows = db
    .prepare(`SELECT DISTINCT json_extract(values_json, '$.${k}') AS v FROM records ORDER BY v`)
    .all();
  console.log(" ", k, JSON.stringify(rows.map((r) => r.v)));
}

console.log("\n== reference values from shared/seed.js ==");
const Seed = require("../shared/seed.js");
const statusField = Seed.DEFAULT_SCHEMA.fields.find((f) => f.key === "status");
console.log("  status", JSON.stringify(statusField.options));
for (const f of Seed.DEFAULT_SCHEMA.fields) {
  if (f.options) console.log("  " + f.key, JSON.stringify(f.options));
}
