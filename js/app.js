/* ============================================================
   CMR Base — แอปหลัก (router + views)
   ============================================================ */

let store = null;
let state = {
  schema: null,
  records: [],
  user: null,
  route: { name: "dashboard" },
  view: localStorage.getItem("cmr_view") || "list",
  search: "",
  filters: { status: "", owner: "" },
  dashFilters: { owner: "", status: "", follow: "", customer: "" },
  sort: { key: "__updated", dir: "desc" },
  cal: null,
  dragId: null
};

const $ = (sel, root) => (root || document).querySelector(sel);

/* ================= boot ================= */
async function boot() {
  showLoading();
  try {
    store = await detectStore();
    updateStorageBadge();
    /* โหมด API: ต้องรู้ตัวผู้ใช้ก่อน เพราะ endpoint ข้อมูลถูกคุมด้วยสิทธิ์ */
    if (store.kind === "api") state.user = await Auth.me();
    if (store.kind !== "api" || state.user) await loadData();
  } catch (e) {
    console.error(e);
    toast("เปิดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  hideLoading();
  bindSidebar();
  window.addEventListener("hashchange", route);
  window.addEventListener("cmr:unauthorized", () => {
    if (!state.user) return;
    state.user = null;
    state.schema = null;
    state.records = [];
    toast(tA("sessionExpired"), "error");
    go("#/login");
  });
  route();
}

/** โหลด schema + ระเบียน (เรียกหลัง login สำเร็จด้วย) */
async function loadData() {
  const db = await store.init();
  state.schema = db.schema;
  state.records = db.records;
}

function updateStorageBadge() {
  const badge = $("#storage-badge");
  const label = $("#storage-label");
  if (!store) return;
  badge.classList.remove("api", "local");
  badge.classList.add(store.kind);
  label.textContent = store.kind === "api" ? "API + MySQL" : "localStorage";
  badge.title = store.label;
}

async function reload() {
  state.schema = await store.getSchema();
  state.records = await store.listRecords();
}

function bindSidebar() {
  $("#btn-export-side").addEventListener("click", exportCsv);
  $("#btn-import-side").addEventListener("click", () => $("#csv-file-input").click());
  $("#btn-logout").addEventListener("click", async () => {
    await Auth.logout();
    state.user = null;
    state.schema = null;
    state.records = [];
    toast("ออกจากระบบแล้ว", "success");
    go("#/login");
  });
  const fileInput = $("#csv-file-input");
  fileInput.addEventListener("change", async () => {
    if (fileInput.files && fileInput.files[0]) await handleCsvFile(fileInput.files[0]);
    fileInput.value = "";
  });
  /* เมนูสลับภาษาใน sidebar (ใช้ component เดียวกับหน้า login) */
  const langBox = $("#sidebar-lang");
  if (langBox && !langBox.childElementCount && typeof langMenu === "function") {
    langBox.append(langMenu());
  }
}

/* ================= router ================= */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const query = {};
  if (queryPart) for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  const parts = pathPart.split("/").filter(Boolean);
  if (!parts.length) return { name: "dashboard", query };
  if (parts[0] === "records") return { name: "records", query };
  if (parts[0] === "pipeline") return { name: "pipeline", query };
  if (parts[0] === "record" && parts[1]) return { name: "detail", id: decodeURIComponent(parts[1]), query };
  if (parts[0] === "form") return { name: "form", id: parts[1] === "new" ? null : decodeURIComponent(parts[1]), query };
  if (parts[0] === "calendar") return { name: "calendar", query };
  if (parts[0] === "settings") return { name: "settings", query };
  if (parts[0] === "users") return { name: "users", query };
  if (parts[0] === "login") return { name: "login", query };
  /* ---- โมดูลใบเสนอราคา ---- */
  if (parts[0] === "quotations") {
    if (parts[1] === "list") return { name: "quot-list", query };
    if (parts[1] === "new") return { name: "quot-new", query };
    if (parts[1] === "settings") return { name: "quot-settings", query };
    return { name: "quotations", query };
  }
  if (parts[0] === "quotation" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    if (parts[2] === "edit") return { name: "quot-edit", id, query };
    if (parts[2] === "print") return { name: "quot-print", id, query };
    return { name: "quot-detail", id, query };
  }
  if (parts[0] === "products") return { name: "products", query };
  return { name: "dashboard", query };
}

/* ================= สิทธิ์ฝั่ง UI ================= */
function perms() {
  /* โหมด localStorage ไม่มีเซิร์ฟเวอร์ → ใช้งานได้เต็มรูปแบบ (ยกเว้นจัดการผู้ใช้) */
  if (store && store.kind === "local") {
    return {
      loggedIn: true, role: "admin", offline: true, isAdmin: true, canWrite: true,
      canExport: true, canImport: true, canManageFields: true,
      canManageUsers: false
    };
  }
  return { offline: false, ...Auth.perms(state.user) };
}

function isAuthRoute() {
  return state.route.name === "login";
}

/** สิทธิ์แก้ไข/ลบรายระเบียน (ตรงกับฝั่งเซิร์ฟเวอร์, โหมดออฟไลน์ให้เต็มสิทธิ์) */
function canEditUI(rec) {
  if (store && store.kind === "local") return true;
  return perms().canWrite && Auth.canEditRecord(rec, state.user);
}
function canDeleteUI(rec) {
  if (store && store.kind === "local") return true;
  return perms().canWrite && Auth.canDeleteRecord(rec, state.user);
}

function route() {
  state.route = parseRoute();
  const p = perms();
  const apiMode = !!store && store.kind === "api";

  /* --- ยามหน้า Login --- */
  if (apiMode && !p.loggedIn && !isAuthRoute()) { go("#/login"); return; }
  if (apiMode && p.loggedIn && isAuthRoute()) { go("#/dashboard"); return; }

  /* --- ยามสิทธิ์ --- */
  if (state.route.name === "users" && !p.canManageUsers) { toast("ต้องเป็นผู้ดูแลระบบ", "error"); go("#/dashboard"); return; }
  if (state.route.name === "settings" && !p.canManageFields) { toast("ต้องเป็นผู้ดูแลระบบเท่านั้น", "error"); go("#/dashboard"); return; }
  if (state.route.name === "form" && !p.canWrite) { toast("บัญชีผู้ชม (viewer) เพิ่ม/แก้ไขไม่ได้", "error"); go("#/records"); return; }

  /* --- ยามโมดูลใบเสนอราคา (ใช้เฉพาะโหมด API + MySQL เท่านั้น) --- */
  const QUO_ROUTES = ["quotations", "quot-list", "quot-new", "quot-settings", "quot-detail", "quot-edit", "quot-print", "products"];
  if (QUO_ROUTES.includes(state.route.name)) {
    if (!apiMode) { toast("ระบบใบเสนอราคาทำงานบน API + MySQL เท่านั้น", "error"); go("#/dashboard"); return; }
    if ((state.route.name === "quot-new" || state.route.name === "quot-edit") && !p.canWrite) {
      toast("บัญชีผู้ชม (viewer) สร้าง/แก้ไขใบเสนอราคาไม่ได้", "error"); go("#/quotations/list"); return;
    }
    if (state.route.name === "quot-settings" && !p.canManageFields) {
      toast("ต้องเป็นผู้ดูแลระบบเท่านั้น", "error"); go("#/quotations"); return;
    }
  }

  document.querySelectorAll(".nav-item").forEach((el) => {
    const map = { detail: "records", form: "records" };
    const key = map[state.route.name] || state.route.name;
    el.classList.toggle("active", el.dataset.route === key);
  });
  updateChrome();
  render();
}

/** อัปเดตส่วนที่อยู่นอก area ที่ render ใหม่ (nav, กล่องผู้ใช้, ปุ่ม sidebar) */
function updateChrome() {
  const p = perms();
  const apiMode = !!store && store.kind === "api";

  const navUsers = $("#nav-users");
  if (navUsers) navUsers.hidden = !(apiMode && p.canManageUsers);
  const navSettings = $("#nav-settings");
  if (navSettings) navSettings.hidden = !p.canManageFields;
  /* โมดูลสินค้าถูกตัดออกจากเมนูแล้ว — ซ่อนไว้กัน HTML เก่า */
  const navProducts = $("#nav-products");
  if (navProducts) navProducts.hidden = true;

  const userBox = $("#user-box");
  if (userBox) {
    userBox.hidden = !apiMode;
    if (apiMode && state.user) {
      $("#user-name").textContent = state.user.display_name;
      $("#user-role").textContent = state.user.role_label;
      $("#user-role").className = "role-pill role-" + state.user.role;
      const avEl = $("#user-avatar");
      if (state.user.avatar) {
        avEl.textContent = "";
        avEl.style.backgroundImage = `url("${state.user.avatar}")`;
      } else {
        avEl.style.backgroundImage = "";
        avEl.textContent = initials(state.user.display_name);
      }
    }
  }

  const imp = $("#btn-import-side");
  if (imp) imp.hidden = !p.canImport;
}

function render() {
  const main = $("#main");
  fill(main);
  document.body.classList.toggle("auth-mode", isAuthRoute());
  document.title = isAuthRoute() ? tA("docTitle") : (typeof T === "function" ? T(DEFAULT_DOC_TITLE) : DEFAULT_DOC_TITLE);
  document.documentElement.lang = typeof curLang === "function" ? curLang() : "th";
  switch (state.route.name) {
    case "login": main.append(viewLogin()); break;
    case "dashboard": main.append(viewDashboard()); break;
    case "records":
      main.append(viewRecords());
      renderRecordsBody();
      break;
    case "pipeline": main.append(viewPipeline()); break;
    case "calendar": main.append(viewCalendar()); break;
    case "detail": main.append(viewDetail(state.route.id)); break;
    case "form": main.append(viewForm(state.route.id)); break;
    case "settings": main.append(viewSettings()); break;
    case "users": main.append(viewUsers()); break;
    /* ---- โมดูลใบเสนอราคา ---- */
    case "quotations": main.append(viewQuotations()); break;
    case "quot-list": main.append(viewQuotationsList(state.route.query)); break;
    case "quot-new": main.append(viewQuotationForm(null, state.route.query)); break;
    case "quot-detail": main.append(viewQuotationDetail(state.route.id)); break;
    case "quot-edit": main.append(viewQuotationForm(state.route.id, state.route.query)); break;
    case "quot-print": main.append(viewQuotationPrint(state.route.id)); break;
    case "quot-settings": main.append(viewQuotationSettings()); break;
    case "products": main.append(viewProducts()); break;
    default: main.append(viewDashboard());
  }
  if (typeof translateDOM === "function") translateDOM(document.body);
  window.scrollTo({ top: 0 });
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/* ================= shared bits ================= */
function topbar({ title, sub, right = [], left = [] }) {
  return h("div", { class: "topbar" },
    left,
    h("div", {},
      h("h1", {}, title),
      sub ? h("p", { class: "sub" }, sub) : null
    ),
    h("div", { class: "topbar-spacer" }),
    right
  );
}

function fieldByKey(key) {
  return (state.schema.fields || []).find((f) => f.key === key);
}

function statusOptions() {
  const f = state.schema.fields.find((f) => f.type === "status");
  return (f && f.options) || [];
}

function optionsFor(key) {
  const f = fieldByKey(key);
  return (f && f.options) || [];
}

function displayValue(field, value) {
  if (value === "" || value === null || value === undefined) return h("span", { class: "muted" }, "—");
  switch (field.type) {
    case "number":
      return fmtNumber(value);
    case "status":
      return statusPill(value, state.schema);
    case "select":
      return h("span", { class: "pill s-other" }, String(value));
    case "checkbox":
      return Array.isArray(value)
        ? h("span", {}, value.map((v) => h("span", { class: "tag" }, v)))
        : h("span", { class: "muted" }, "—");
    case "email":
      return h("a", { href: "mailto:" + value, onclick: (e) => e.stopPropagation() }, String(value));
    case "url": {
      const href = /^https?:/i.test(value) ? value : "https://" + value;
      return h("a", { href: href, target: "_blank", rel: "noopener", onclick: (e) => e.stopPropagation() }, String(value));
    }
    case "phone":
      return h("a", { href: "tel:" + String(value).replace(/\s/g, ""), onclick: (e) => e.stopPropagation() }, String(value));
    case "date":
      return fmtDate(value);
    default:
      return String(value);
  }
}

function recordTitle(rec) {
  const f = state.schema.fields.find((x) => x.key === "company") || state.schema.fields[0];
  return rec.values[f.key] || "(ไม่มีชื่อ)";
}

/* ================= filtering ================= */
function visibleRecords() {
  const q = state.search.trim().toLowerCase();
  let list = state.records.filter((rec) => {
    if (state.filters.status && rec.values.status !== state.filters.status) return false;
    if (state.filters.owner && rec.values.owner !== state.filters.owner) return false;
    if (q) {
      const hay = Object.entries(rec.values)
        .map(([k, v]) => Array.isArray(v) ? v.join(" ") : String(v ?? ""))
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const { key, dir } = state.sort;
  const mult = dir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let va, vb;
    if (key === "__updated") { va = a.updated_at; vb = b.updated_at; }
    else { va = a.values[key]; vb = b.values[key]; }
    if (typeof va === "number" || typeof vb === "number") {
      const na = Number(va) || 0, nb = Number(vb) || 0;
      return (na - nb) * mult;
    }
    if (Array.isArray(va)) va = va.join(",");
    if (Array.isArray(vb)) vb = vb.join(",");
    return String(va || "").localeCompare(String(vb || ""), "th") * mult;
  });
  return list;
}

/* ================= dashboard ================= */
const DASH_OWNER_ALL = "งานของแต่ละคนทั้งหมด";
const DASH_STATUS_ALL = "ทุกสถานะ";
const DASH_FOLLOW_ALL = "นัดหมายทั้งหมด";
const DASH_CUSTOMER_ALL = "ลูกค้าทั้งหมด";
const DASH_FOLLOW_OPTIONS = [
  DASH_FOLLOW_ALL, "ภายใน 7 วัน", "ภายใน 30 วัน", "ภายใน 90 วัน", "เลยกำหนด", "ไม่มีนัดหมาย"
];

/** กรองตามตัวเลือกดรอปดาว "นัดหมายครั้งถัดไป" */
function matchDashFollow(rec, follow, today) {
  if (!follow || follow === DASH_FOLLOW_ALL) return true;
  const d = rec.values.next_followup;
  if (follow === "ไม่มีนัดหมาย") return !d;
  if (!d) return false;
  if (follow === "เลยกำหนด") return d < today;
  const days = Number((String(follow).match(/\d+/) || [0])[0]);
  const until = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  return d >= today && d <= until;
}

function viewDashboard() {
  const df = state.dashFilters;
  const today = new Date().toISOString().slice(0, 10);
  /* กรองด้วย 4 ดรอปดาวก่อน แล้วค่อยคำนวณทุกส่วนของหน้า */
  const recs = state.records.filter((r) => {
    if (df.owner && r.values.owner !== df.owner) return false;
    if (df.status && r.values.status !== df.status) return false;
    if (df.customer && recordTitle(r) !== df.customer) return false;
    return matchDashFollow(r, df.follow, today);
  });
  const customers = [...new Set(state.records.map((r) => recordTitle(r)))]
    .sort((a, b) => String(a).localeCompare(String(b), "th"));
  const wonStatuses = ["ปิดการขาย", "ลูกค้าประจำ"];
  const valueOf = (r) => Number(r.values.deal_value) || 0;
  const totalValue = recs.reduce((s, r) => s + valueOf(r), 0);
  const wonValue = recs.filter((r) => wonStatuses.includes(r.values.status)).reduce((s, r) => s + valueOf(r), 0);
  const soon = recs.filter((r) => r.values.next_followup && r.values.next_followup >= today)
    .sort((a, b) => a.values.next_followup.localeCompare(b.values.next_followup));

  const kpis = h("div", { class: "kpi-grid" },
    kpi("ลูกค้าทั้งหมด", fmtNumber(recs.length), "ระเบียนในระบบ", ""),
    kpi("มูลค่าดีลรวม", fmtMoney(totalValue), "ทุกสถานะ", "cyan"),
    kpi("ดีลที่ปิดแล้ว", fmtMoney(wonValue), recs.filter((r) => wonStatuses.includes(r.values.status)).length + " ราย", "green"),
    kpi("นัดหมายที่จะถึง", fmtNumber(soon.length), "ภายใน 90 วัน", "amber")
  );

  /* จำนวนตามสถานะ */
  const byStatus = statusOptions().map((s) => {
    const rows = recs.filter((r) => r.values.status === s);
    return { label: s, count: rows.length, value: rows.reduce((sum, r) => sum + valueOf(r), 0) };
  });
  const maxCount = Math.max(1, ...byStatus.map((b) => b.count));

  const statusCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "สถิติตามสถานะ"),
    h("div", { class: "card-body" },
      byStatus.map((b) => h("div", { class: "bar-row" },
        h("div", { class: "bar-label" }, b.label),
        h("div", { class: "bar-track" },
          h("div", { class: "bar-fill", style: { width: (b.count / maxCount * 100) + "%" } })),
        h("div", { class: "bar-value" }, b.count)
      )),
      h("div", { class: "small muted mt16" },
        "มูลค่าดีลรวมตามสถานะ: " + byStatus.map((b) => `${b.label} ${fmtMoney(b.value)}`).join(" · "))
    )
  );

  /* ตามผู้รับผิดชอบ */
  const owners = optionsFor("owner");
  const ownerRows = owners.map((o) => {
    const rows = recs.filter((r) => r.values.owner === o);
    return h("div", { class: "list-item" },
      h("div", { class: "avatar" }, initials(o)),
      h("div", { class: "li-main" },
        h("div", { class: "li-title" }, o),
        h("div", { class: "li-sub" }, rows.length + " ราย · " + fmtMoney(rows.reduce((s, r) => s + valueOf(r), 0)))
      )
    );
  });

  const ownerCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "งานของแต่ละคน"),
    h("div", { class: "card-body" }, ownerRows.length ? ownerRows : h("p", { class: "muted mb0" }, "ยังไม่มีข้อมูล"))
  );

  /* อัปเดตล่าสุด */
  const recent = [...recs].sort((a, b) => b.updated_at - a.updated_at).slice(0, 7);
  const recentCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "อัปเดตล่าสุด"),
    h("div", { class: "card-body" },
      recent.map((r) => h("div", { class: "list-item", style: { cursor: "pointer" }, onclick: () => go("#/record/" + r.id) },
        h("div", { class: "avatar" }, initials(r.values.contact_name || recordTitle(r))),
        h("div", { class: "li-main" },
          h("div", { class: "li-title" }, recordTitle(r)),
          h("div", { class: "li-sub" }, relTime(r.updated_at) + " · " + (r.values.owner || "ไม่ระบุผู้รับผิดชอบ"))
        ),
        statusPill(r.values.status, state.schema)
      ))
    )
  );

  /* นัดหมายถัดไป */
  const followCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "นัดหมายครั้งถัดไป"),
    h("div", { class: "card-body" },
      soon.length
        ? soon.slice(0, 7).map((r) => h("div", { class: "list-item", style: { cursor: "pointer" }, onclick: () => go("#/record/" + r.id) },
            h("div", { class: "li-main" },
              h("div", { class: "li-title" }, recordTitle(r)),
              h("div", { class: "li-sub" }, "ติดตาม " + fmtDate(r.values.next_followup))
            ),
            h("span", { class: "pill s-other" }, r.values.priority || "—")
          ))
        : h("p", { class: "muted mb0" }, "ยังไม่มีนัดหมายที่กำหนด")
    )
  );

  /* 4 ดรอปดาวกรองแดชบอร์ด (แทนปุ่มเพิ่มระเบียน) */
  const dashControls = h("div", { class: "row" },
    selectControl(df.owner, [DASH_OWNER_ALL, ...optionsFor("owner")], (v) => {
      state.dashFilters.owner = v === DASH_OWNER_ALL ? "" : v; render();
    }),
    selectControl(df.status, [DASH_STATUS_ALL, ...statusOptions()], (v) => {
      state.dashFilters.status = v === DASH_STATUS_ALL ? "" : v; render();
    }),
    selectControl(df.follow, DASH_FOLLOW_OPTIONS, (v) => {
      state.dashFilters.follow = v === DASH_FOLLOW_ALL ? "" : v; render();
    }),
    selectControl(df.customer, [DASH_CUSTOMER_ALL, ...customers], (v) => {
      state.dashFilters.customer = v === DASH_CUSTOMER_ALL ? "" : v; render();
    })
  );

  return h("div", {},
    topbar({
      title: "แดชบอร์ด",
      sub: "ภาพรวมข้อมูลลูกค้า · อัปเดต " + fmtDateTime(Date.now()),
      right: [dashControls]
    }),
    h("div", { class: "page" },
      kpis,
      h("div", { class: "dash-grid" },
        h("div", {}, statusCard, h("div", { class: "mt16" }, recentCard)),
        h("div", {}, ownerCard, h("div", { class: "mt16" }, followCard))
      )
    )
  );
}

function kpi(label, value, sub, tone) {
  return h("div", { class: "kpi " + tone },
    h("div", { class: "k-label" }, label),
    h("div", { class: "k-value" }, value),
    h("div", { class: "k-sub" }, sub)
  );
}

/* ================= calendar (ติดตามงานตามวันที่) ================= */
/** วันนี้ในรูป YYYY-MM-DD ตามเวลาเครื่อง (ไม่ใช่ UTC เหมือน toISOString) */
function localToday() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ---------- ข้อความงานในปฏิทิน (แก้ไขได้ เก็บเฉพาะเครื่อง — ไม่แตะฐานข้อมูลจริง) ---------- */
const CAL_NOTE_KEY = "cmr_cal_notes";
function calNotes() {
  try { return JSON.parse(localStorage.getItem(CAL_NOTE_KEY) || "{}"); } catch { return {}; }
}
/** ข้อความที่แสดงบนชิปงาน = ข้อความที่แก้ไว้ในเครื่อง (ถ้ามี) มิฉะั้น = ชื่อลูกค้า */
function calText(r) {
  const n = calNotes()[r.id];
  return (n !== undefined && String(n).trim()) ? String(n) : recordTitle(r);
}
function openCalNoteModal(r) {
  const notes = calNotes();
  const original = recordTitle(r);
  const hasNote = notes[r.id] !== undefined;
  const inp = h("textarea", { class: "control", rows: 3, placeholder: original });
  inp.value = hasNote ? notes[r.id] : "";
  const err = authErrorBox();

  const persist = (value) => {
    const all = calNotes();
    if (value === null) delete all[r.id];
    else all[r.id] = value;
    localStorage.setItem(CAL_NOTE_KEY, JSON.stringify(all));
    closeModal();
    render();
  };

  openModal({
    title: "แก้ไขข้อความงาน",
    body: h("div", {},
      h("p", { class: "muted small" }, "ข้อความนี้บันทึกเฉพาะเครื่องนี้เท่านั้น ไม่ส่งขึ้นฐานข้อมูลจริง"),
      authField("ข้อความตารางงาน", inp, "ชื่อเดิม: " + original),
      err
    ),
    footer: [
      h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
      hasNote ? h("button", { class: "btn", onclick: () => { persist(null); toast("กลับเป็นชื่อเดิมแล้ว", "success"); } }, "ล้างกลับเป็นชื่อเดิม") : null,
      h("button", { class: "btn primary", onclick: () => {
        const v = inp.value.trim();
        if (!v || v === original) { persist(null); toast("กลับเป็นชื่อเดิมแล้ว", "success"); return; }
        persist(v);
        toast("บันทึกข้อความแล้ว (เฉพาะเครื่องนี้)", "success");
      } }, "บันทึก")
    ]
  });
}

/** วันสิ้นเดือนของเดือนถัดไป/ก่อนหน้า ใช้คุม cursor ของปฏิทิน */
function shiftMonth(delta) {
  const c = state.cal || { y: new Date().getFullYear(), m: new Date().getMonth() };
  const d = new Date(c.y, c.m + delta, 1);
  state.cal = { y: d.getFullYear(), m: d.getMonth() };
  render();
}

function viewCalendar() {
  if (!state.cal) {
    const n = new Date();
    state.cal = { y: n.getFullYear(), m: n.getMonth() };
  }
  const { y, m } = state.cal;
  const today = localToday();
  const loc = typeof i18nLocale === "function" ? i18nLocale() : "th-TH";

  /* จับระเบียนที่มี "นัดครั้งถัดไป" รวมเป็น map ตามวันที่ */
  const byDate = {};
  for (const r of state.records) {
    const d = r.values.next_followup;
    if (!d) continue;
    (byDate[d] = byDate[d] || []).push(r);
  }

  /* หัวตาราง: ชื่อวันตาม locale ปัจจุบัน (จันทร์→อาทิตย์) */
  const weekFmt = new Intl.DateTimeFormat(loc, { weekday: "short" });
  const dows = [1, 2, 3, 4, 5, 6, 0].map((dow) =>
    h("div", { class: "cal-dow" }, weekFmt.format(new Date(2024, 0, 7 + dow)))
  );

  /* startdate = วันอาทิตย์ก่อนวันแรกของเดือน → 42 ช่อง (6 สัปดาห์) */
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const monthFmt = new Intl.DateTimeFormat(loc, { month: "long", year: "numeric" });

  let monthCount = 0;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const items = byDate[key] || [];
    if (d.getMonth() === m) monthCount += items.length;
    const past = key < today;
    cells.push(h("div", {
      class: "cal-day" +
        (d.getMonth() === m ? "" : " other") +
        (key === today ? " today" : "") +
        (items.length && past ? " overdue" : "")
      },
      h("div", { class: "cal-date" }, String(d.getDate())),
      items.slice(0, 3).map((r) => h("div", {
        class: "cal-item",
        title: calText(r) + " · " + (r.values.status || "—"),
        onclick: () => go("#/record/" + r.id)
      },
        h("span", { class: "cal-item-name" }, calText(r)),
        statusPill(r.values.status, state.schema),
        h("button", {
          class: "cal-edit", title: "แก้ไขข้อความงาน", "aria-label": "แก้ไขข้อความงาน",
          onclick: (e) => { e.stopPropagation(); openCalNoteModal(r); }
        }, "✎")
      )),
      items.length > 3 ? h("div", { class: "cal-more" }, "+" + (items.length - 3)) : null
    ));
  }

  const calCard = h("div", { class: "card cal-card" },
    h("div", { class: "cal-toolbar" },
      h("div", { class: "cal-title" }, monthFmt.format(first)),
      h("div", { class: "row" },
        h("button", { class: "btn sm", onclick: () => shiftMonth(-1) }, "← เดือนก่อน"),
        h("button", { class: "btn sm", onclick: () => { const n = new Date(); state.cal = { y: n.getFullYear(), m: n.getMonth() }; render(); } }, "วันนี้"),
        h("button", { class: "btn sm", onclick: () => shiftMonth(1) }, "เดือนถัดไป →")
      )
    ),
    h("div", { class: "cal-grid" },
      dows
    ),
    h("div", { class: "cal-grid cal-days" }, cells),
    h("div", { class: "small muted mt16" }, "งานเดือนนี้ " + monthCount + " รายการ")
  );

  return h("div", {},
    topbar({
      title: "ปฏิทินติดตามงาน",
      sub: "งานที่นัดตามวันที่ (นัดครั้งถัดไป) เพื่อไม่ให้งานหลุด"
    }),
    h("div", { class: "page" },
      h("div", { class: "cal-layout" }, calCard)
    )
  );
}

/* ================= records list / grid ================= */
function viewRecords() {
  const controls = h("div", { class: "row" },
    h("div", { class: "search-box" },
      h("input", {
        type: "search", placeholder: "ค้นหาลูกค้า, อีเมล, เบอร์โทร…",
        value: state.search,
        oninput: debounce((e) => { state.search = e.target.value; renderRecordsBody(); }, 200)
      })
    ),
    selectControl(state.filters.status, ["ทุกสถานะ", ...statusOptions()], (v) => {
      state.filters.status = v === "ทุกสถานะ" ? "" : v; renderRecordsBody();
    }),
    selectControl(state.filters.owner, ["ผู้รับผิดชอบทั้งหมด", ...optionsFor("owner")], (v) => {
      state.filters.owner = v.startsWith("ผู้รับผิดชอบ") ? "" : v; renderRecordsBody();
    }),
    h("div", { class: "seg" },
      h("button", { class: state.view === "list" ? "active" : "", onclick: () => setView("list") }, "รายการ"),
      h("button", { class: state.view === "grid" ? "active" : "", onclick: () => setView("grid") }, "การ์ด")
    )
  );

  return h("div", {},
    topbar({
      title: "รายชื่อลูกค้า",
      right: [
        controls,
        h("button", { class: "btn", onclick: exportCsv }, "ส่งออก CSV"),
        perms().canWrite ? h("button", { class: "btn primary", onclick: () => go("#/form/new") }, "+ เพิ่มระเบียน") : null
      ]
    }),
    h("div", { class: "page" },
      h("div", { id: "records-body" })
    )
  );
}

function setView(v) {
  state.view = v;
  localStorage.setItem("cmr_view", v);
  render();
}

function selectControl(value, options, onChange) {
  const sel = h("select", { class: "control", onchange: (e) => onChange(e.target.value) },
    options.map((o) => h("option", { value: o }, o))
  );
  sel.value = value || options[0];
  return sel;
}

function renderRecordsBody() {
  const root = $("#records-body");
  if (!root) return;
  fill(root);

  const list = visibleRecords();
  const filtering = state.search || state.filters.status || state.filters.owner;

  root.append(h("div", { class: "row spread", style: { marginBottom: "10px" } },
    h("div", { class: "muted small" },
      `แสดง ${list.length} จาก ${state.records.length} ระเบียน`),
    filtering
      ? h("button", {
          class: "btn sm",
          onclick: () => { state.search = ""; state.filters = { status: "", owner: "" }; render(); }
        }, "ล้างตัวกรอง")
      : null
  ));

  if (!list.length) {
    root.append(h("div", { class: "card empty" },
      h("div", { class: "e-ico" }, "🔍"),
      h("h3", {}, filtering ? "ไม่พบระเบียนที่ค้นหา" : "ยังไม่มีระเบียนลูกค้า"),
      h("p", {}, filtering ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง" : "เริ่มต้นด้วยการเพิ่มระเบียนแรก หรือนำเข้าจากไฟล์ CSV"),
      perms().canWrite ? h("button", { class: "btn primary", onclick: () => go("#/form/new") }, "+ เพิ่มระเบียน") : null
    ));
    if (typeof translateDOM === "function") translateDOM(root);
    return;
  }

  if (state.view === "grid") root.append(renderGrid(list));
  else root.append(renderTable(list));
  if (typeof translateDOM === "function") translateDOM(root);
}

function tableColumns() {
  return [
    ...state.schema.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, field: f })),
    { key: "__updated", label: "อัปเดตล่าสุด", type: "system" }
  ];
}

function renderTable(list) {
  const cols = tableColumns();
  const wrap = h("div", { class: "card table-wrap" });
  const table = h("table", { class: "data" });

  const thead = h("thead", {}, h("tr", {},
    cols.map((c) => {
      const active = state.sort.key === c.key;
      return h("th", {
        onclick: () => {
          if (active) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
          else state.sort = { key: c.key, dir: "asc" };
          renderRecordsBody();
        }
      }, c.label, active ? h("span", { class: "arrow" }, state.sort.dir === "asc" ? " ▲" : " ▼") : null);
    })
  ));

  const tbody = h("tbody", {},
    list.map((rec) => h("tr", { onclick: () => go("#/record/" + rec.id) },
      cols.map((c) => {
        if (c.key === "__updated") {
          return h("td", { class: "muted small" }, relTime(rec.updated_at));
        }
        const isPrimary = c.key === "company";
        const inner = h("span", { class: "cell" }, displayValue(c.field, rec.values[c.key]));
        return h("td", { class: (c.type === "number" ? "num " : "") + (isPrimary ? "primary-cell" : "") }, inner);
      })
    ))
  );

  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function renderGrid(list) {
  return h("div", { class: "grid-view" },
    list.map((rec) => h("div", { class: "record-card", onclick: () => go("#/record/" + rec.id) },
      h("div", { class: "rc-title" }, recordTitle(rec)),
      h("div", { class: "rc-code" }, rec.values.customer_code || rec.id),
      h("div", { class: "row", style: { marginBottom: "6px" } }, statusPill(rec.values.status, state.schema)),
      h("div", { class: "rc-row" }, h("span", {}, "ผู้รับผิดชอบ"), h("b", {}, rec.values.owner || "—")),
      h("div", { class: "rc-row" }, h("span", {}, "มูลค่าดีล"), h("b", {}, fmtMoney(rec.values.deal_value))),
      h("div", { class: "rc-row" }, h("span", {}, "นัดครั้งถัดไป"), h("b", {}, rec.values.next_followup ? fmtDate(rec.values.next_followup) : "—"))
    ))
  );
}

/* ================= pipeline (kanban) ================= */
function viewPipeline() {
  const cols = statusOptions();
  const list = visibleRecords();

  const board = h("div", { class: "kanban" },
    cols.map((s) => {
      const rows = list.filter((r) => r.values.status === s);
      const body = h("div", { class: "kanban-col-body", dataset: { status: s } });
      rows.forEach((rec) => body.append(kanbanCard(rec)));

      const col = h("div", { class: "kanban-col" },
        h("div", { class: "kanban-col-head" },
          h("span", {}, statusPill(s, state.schema)),
          h("span", { class: "count" }, rows.length)
        ),
        body
      );

      body.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop-active"); });
      body.addEventListener("dragleave", () => col.classList.remove("drop-active"));
      body.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.classList.remove("drop-active");
        const id = state.dragId;
        if (!id) return;
        const rec = state.records.find((r) => r.id === id);
        if (!rec || rec.values.status === s) return;
        try {
          showLoading();
          await store.setStatus(id, s);
          await reload();
          hideLoading();
          toast(`ย้าย "${recordTitle(rec)}" ไปที่สถานะ ${s}`, "success");
          render();
        } catch (err) {
          hideLoading();
          toast("บันทึกไม่สำเร็จ: " + err.message, "error");
        }
      });

      return col;
    })
  );

  return h("div", {},
    topbar({
      title: h("span", { "data-t": "navPipeline" }, "สถานะ"),
      sub: "ลากการ์ดไปมาระหว่างคอลัมน์เพื่อเปลี่ยนสถานะ (ลากได้เฉพาะเมื่อใช้ร่วมกับเซิร์ฟเวอร์หรือเบราว์เซอร์เครื่องเดียว)"
    }),
    h("div", { class: "page" }, board)
  );
}

function kanbanCard(rec) {
  const card = h("div", { class: "kanban-card", draggable: "true", onclick: () => go("#/record/" + rec.id) },
    h("div", { class: "kc-title" }, recordTitle(rec)),
    h("div", { class: "kc-meta" },
      h("span", {}, rec.values.owner || "—"),
      h("span", { class: "kc-value" }, fmtMoney(rec.values.deal_value))
    ),
    h("div", { class: "kc-meta" },
      h("span", {}, rec.values.customer_code || ""),
      h("span", {}, rec.values.next_followup ? "นัด " + fmtDate(rec.values.next_followup) : "")
    )
  );
  card.addEventListener("dragstart", (e) => {
    state.dragId = rec.id;
    card.classList.add("dragging");
    try { e.dataTransfer.setData("text/plain", rec.id); e.dataTransfer.effectAllowed = "move"; } catch (err) { /* noop */ }
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    state.dragId = null;
  });
  return card;
}

/* ================= detail ================= */
function viewDetail(id) {
  const rec = state.records.find((r) => r.id === id);
  if (!rec) {
    return h("div", { class: "page" },
      h("div", { class: "card empty" },
        h("div", { class: "e-ico" }, "❓"),
        h("h3", {}, "ไม่พบระเบียนนี้"),
        h("p", {}, "ระเบียนอาจถูกลบไปแล้ว"),
        h("button", { class: "btn primary", onclick: () => go("#/records") }, "กลับไปที่รายชื่อ")
      )
    );
  }

  const head = topbar({
    left: [h("button", { class: "btn ghost", onclick: () => history.length > 1 ? history.back() : go("#/records") }, "← กลับ")],
    title: recordTitle(rec),
    sub: (rec.values.customer_code ? rec.values.customer_code + " · " : "") + "อัปเดต " + fmtDateTime(rec.updated_at),
    right: [
      h("div", { class: "row", style: { flexWrap: "wrap" } },
        (perms().canWrite && perms().loggedIn && !perms().offline && store && store.kind === "api")
          ? h("button", { class: "btn primary", onclick: () => go("#/quotations/new?customer=" + encodeURIComponent(rec.id)) }, "📄 สร้างใบเสนอราคา")
          : null,
        canEditUI(rec) ? (() => {
          const sel = h("select", {
            class: "control",
            onchange: async (e) => {
              const v = e.target.value;
              if (!v || v === rec.values.status) return;
              try {
                showLoading();
                await store.setStatus(rec.id, v);
                await reload();
                hideLoading();
                toast("เปลี่ยนสถานะแล้ว", "success");
                render();
              } catch (err) { hideLoading(); toast(err.message, "error"); }
            }
          }, statusOptions().map((s) => h("option", { value: s }, s)));
          sel.value = rec.values.status || "";
          return sel;
        })() : null,
        canEditUI(rec) ? h("button", { class: "btn", onclick: () => go("#/form/" + rec.id) }, "แก้ไข") : null,
        canDeleteUI(rec) ? h("button", {
          class: "btn danger",
          onclick: async () => {
            const ok = await confirmDialog(`ต้องการลบระเบียน "${recordTitle(rec)}" ใช่หรือไม่?`, { danger: true, okText: "ลบ" });
            if (!ok) return;
            try {
              await store.deleteRecord(rec.id);
              await reload();
              toast("ลบระเบียนแล้ว", "success");
              go("#/records");
            } catch (err) { toast(err.message, "error"); }
          }
        }, "ลบ") : null
      )
    ]
  });

  const fieldsCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ข้อมูลลูกค้า"),
    h("div", { class: "card-body" },
      h("div", { class: "fields-grid" },
        state.schema.fields.map((f) => h("div", { class: "field-row" },
          h("div", { class: "f-label" }, f.label),
          h("div", { class: "f-value" + (isEmpty(rec.values[f.key]) ? " empty" : "") },
            isEmpty(rec.values[f.key]) ? "—" : displayValue(f, rec.values[f.key]))
        ))
      )
    )
  );

  /* timeline */
  const timeline = h("div", { class: "timeline" });
  const renderTimeline = () => {
    fill(timeline);
    const acts = [...(rec.activities || [])].sort((a, b) => b.at - a.at);
    if (!acts.length) timeline.append(h("p", { class: "muted mb0" }, "ยังไม่มีกิจกรรม"));
    acts.forEach((a) => {
      const isComment = a.type === "comment";
      timeline.append(h("div", { class: "tl-item" + (isComment ? "" : " system") },
        h("div", { class: "avatar" }, isComment ? initials(a.author) : "•"),
        h("div", { class: "tl-body" },
          h("div", { class: "tl-head" },
            h("span", {}, h("strong", {}, a.author || "ระบบ"), " ", a.text),
            h("span", {}, fmtDateTime(a.at))
          )
        )
      ));
    });
  };
  renderTimeline();

  /* โหลดกิจกรรมล่าสุดจากเซิร์ฟเวอร์ (เหตุการณ์จากโมดูลอื่น เช่น ใบเสนอราคา ไม่อยู่ใน state เดิม) */
  if (store && store.kind === "api") {
    store.getRecord(rec.id).then((fresh) => {
      if (fresh && Array.isArray(fresh.activities)) {
        rec.activities = fresh.activities;
        rec.updated_at = fresh.updated_at;
        renderTimeline();
      }
    }).catch(() => { /* เงียบ — ใช้ข้อมูลที่โหลดมาตอนแรกแทน */ });
  }

  const ta = h("textarea", { placeholder: "พิมพ์ความคิดเห็นหรือบันทึกการติดต่อ…" });
  const activityCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ความเคลื่อนไหว & บันทึก"),
    h("div", { class: "card-body" },
      timeline,
      perms().canWrite ? h("div", { class: "comment-box" },
        ta,
        h("button", {
          class: "btn primary",
          onclick: async () => {
            const text = ta.value.trim();
            if (!text) return toast("พิมพ์ข้อความก่อนส่ง", "error");
            try {
              await store.addComment(rec.id, text);
              await reload();
              const fresh = state.records.find((r) => r.id === rec.id);
              if (fresh) rec.activities = fresh.activities;
              ta.value = "";
              renderTimeline();
              toast("บันทึกความคิดเห็นแล้ว", "success");
            } catch (err) { toast(err.message, "error"); }
          }
        }, "ส่ง")
      ) : h("p", { class: "muted small mb0" }, "บัญชีผู้ชม (viewer) อ่านอย่างเดียว ไม่สามารถเพิ่มความคิดเห็นได้")
    )
  );

  /* ---- ประวัติใบเสนอราคาของลูกค้ารายนี้ (โหลดจาก API เมื่อใช้โหมด MySQL) ---- */
  const quoHistoryCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ประวัติใบเสนอราคา",
      perms().canWrite && store && store.kind === "api"
        ? h("a", { href: "#/quotations/new?customer=" + encodeURIComponent(rec.id), class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } }, "+ สร้างใบเสนอราคาให้ลูกค้ารายนี้")
        : null),
    h("div", { class: "card-body" }, h("p", { class: "muted mb0 small" }, "กำลังโหลด…"))
  );
  if (store && store.kind === "api") {
    QuoApi.list({ customer_id: rec.id, per_page: 50, sort: "issue_date", dir: "desc" })
      .then((data) => {
        const body = quoHistoryCard.querySelector(".card-body");
        if (!body) return;
        if (!data.items.length) {
          fill(body, h("p", { class: "muted mb0" }, "ลูกค้ารายนี้ยังไม่มีใบเสนอราคา"));
          return;
        }
        fill(body,
          h("div", { class: "table-wrap" }, h("table", { class: "data" },
            h("thead", {}, h("tr", {}, ["เลขที่", "วันที่ออก", "มูลค่ารวม", "สถานะ"].map((t, i) =>
              h("th", { class: i === 2 ? "num" : "" }, t)))),
            h("tbody", {}, data.items.map((q) => h("tr", { style: { cursor: "pointer" }, onclick: () => go("#/quotation/" + q.id) },
              h("td", { class: "primary-cell mono" }, q.quotation_number),
              h("td", {}, fmtDate(q.issue_date)),
              h("td", { class: "num" }, fmtMoney(q.grand_total)),
              h("td", {}, quoStatusPill(q.status))
            )))))
        );
      })
      .catch(() => {
        const body = quoHistoryCard.querySelector(".card-body");
        if (body) fill(body, h("p", { class: "muted mb0 small" }, "โหลดประวัติใบเสนอราคาไม่สำเร็จ"));
      });
  } else {
    fill(quoHistoryCard.querySelector(".card-body"), h("p", { class: "muted mb0" }, "โหมดออฟไลน์ (localStorage) ไม่รองรับใบเสนอราคา"));
  }

  return h("div", {},
    head,
    h("div", { class: "page" },
      h("div", { class: "dash-grid" },
        h("div", {}, fieldsCard, h("div", { class: "mt16" }, activityCard)),
        h("div", {}, h("div", { class: "card" },
          h("div", { class: "card-head" }, "ข้อมูลโดยย่อ"),
          h("div", { class: "card-body" },
            summaryLine("สถานะ", statusPill(rec.values.status, state.schema)),
            summaryLine("ผู้รับผิดชอบ", rec.values.owner || "—"),
            summaryLine("มูลค่าดีล", fmtMoney(rec.values.deal_value)),
            summaryLine("ความสำคัญ", rec.values.priority || "—"),
            summaryLine("นัดครั้งถัดไป", rec.values.next_followup ? fmtDate(rec.values.next_followup) : "—"),
            summaryLine("แหล่งที่มา", rec.values.source || "—"),
            summaryLine("สร้างโดย", rec.creator_name || "ระบบ"),
            summaryLine("สร้างเมื่อ", fmtDateTime(rec.created_at)),
            summaryLine("ระเบียน ID", h("span", { class: "mono small" }, rec.id))
          )
        ),
        h("div", { class: "mt16" }, quoHistoryCard)
      )
    )
    )
  );
}

function summaryLine(label, value) {
  return h("div", { class: "field-row" },
    h("div", { class: "f-label" }, label),
    h("div", { class: "f-value" }, value)
  );
}

function isEmpty(v) {
  return v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length);
}

/* ================= form (create / edit) ================= */
function viewForm(id) {
  const editing = !!id;
  const rec = editing ? state.records.find((r) => r.id === id) : null;
  if (editing && !rec) return viewDetail(id);
  if (editing && !canEditUI(rec)) {
    setTimeout(() => toast("คุณไม่มีสิทธิ์แก้ไขระเบียนนี้", "error"), 50);
    return viewDetail(id);
  }

  const values = {};
  state.schema.fields.forEach((f) => {
    let v = rec ? rec.values[f.key] : "";
    if (v === undefined || v === null) v = "";
    if (f.type === "checkbox" && !Array.isArray(v)) v = v ? [v] : [];
    values[f.key] = v;
  });
  if (!editing && !values.status) values.status = "Lead";

  const inputs = {};
  const grid = h("div", { class: "form-grid" },
    state.schema.fields.map((f) => {
      const el = buildInput(f, values[f.key]);
      inputs[f.key] = el;
      const wrap = h("div", { class: "form-field" + (f.type === "longtext" ? " full" : "") },
        h("label", {}, f.label, f.required ? h("span", { class: "req" }, "*") : null),
        el,
        h("div", { class: "err-msg", style: { display: "none" } })
      );
      return wrap;
    })
  );

  const formCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, editing ? "แก้ไขระเบียน" : "เพิ่มระเบียนใหม่"),
    h("div", { class: "card-body" }, grid,
      h("div", { class: "form-actions" },
        h("button", { class: "btn", onclick: () => history.length > 1 ? history.back() : go("#/records") }, "ยกเลิก"),
        h("button", { class: "btn primary", onclick: submit }, editing ? "บันทึกการแก้ไข" : "สร้างระเบียน")
      )
    )
  );

  function setError(fieldEl, msg) {
    const input = fieldEl.querySelector("input, select, textarea");
    const err = fieldEl.querySelector(".err-msg");
    if (msg) {
      fieldEl.classList.add("has-err");
      if (input) input.classList.add("err");
      if (err) { err.textContent = msg; err.style.display = "block"; }
    } else {
      if (input) input.classList.remove("err");
      if (err) err.style.display = "none";
    }
  }

  async function submit() {
    const out = {};
    let firstBad = null;

    state.schema.fields.forEach((f) => {
      const fieldEl = inputs[f.key].closest(".form-field");
      let v;
      if (f.type === "checkbox") {
        v = Array.from(fieldEl.querySelectorAll("input:checked")).map((i) => i.value);
      } else {
        v = inputs[f.key].value;
        if (typeof v === "string") v = v.trim();
      }
      let err = "";
      if (f.required && isEmpty(v)) err = "จำเป็นต้องกรอก";
      if (!err && v !== "" && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) err = "รูปแบบอีเมลไม่ถูกต้อง";
      if (!err && v !== "" && f.type === "number" && isNaN(Number(v))) err = "ต้องเป็นตัวเลข";
      setError(fieldEl, err);
      if (err && !firstBad) firstBad = fieldEl;
      if (!err && f.type === "number" && v !== "") v = Number(v);
      out[f.key] = v;
    });

    if (firstBad) {
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
      const inp = firstBad.querySelector("input, select, textarea");
      if (inp) inp.focus();
      toast("กรุณาตรวจสอบฟิลด์ที่มีเครื่องหมาย *", "error");
      return;
    }

    try {
      showLoading();
      const saved = editing ? await store.updateRecord(id, out) : await store.createRecord(out);
      await reload();
      hideLoading();
      toast(editing ? "บันทึกการแก้ไขแล้ว" : "เพิ่มระเบียนแล้ว", "success");
      go("#/record/" + saved.id);
    } catch (e) {
      hideLoading();
      toast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
  }

  return h("div", {},
    topbar({
      left: [h("button", { class: "btn ghost", onclick: () => history.length > 1 ? history.back() : go("#/records") }, "← กลับ")],
      title: editing ? "แก้ไขระเบียน" : "เพิ่มระเบียนใหม่",
      sub: state.schema.name
    }),
    h("div", { class: "page" },
      h("div", { style: { maxWidth: "1100px" } }, formCard)
    )
  );
}

function buildInput(field, value) {
  const common = { id: "f_" + field.key };
  switch (field.type) {
    case "longtext": {
      const el = h("textarea", { ...common, rows: "3" });
      el.value = value || "";
      return el;
    }
    case "select":
    case "status": {
      const el = h("select", { ...common },
        h("option", { value: "" }, "— เลือก —"),
        (field.options || []).map((o) => h("option", { value: o }, o))
      );
      el.value = value || "";
      return el;
    }
    case "checkbox": {
      const checked = Array.isArray(value) ? value : [];
      return h("div", { class: "checks", ...common },
        (field.options || []).map((o) =>
          h("label", {},
            h("input", { type: "checkbox", value: o, checked: checked.includes(o) }), " " + o
          )
        )
      );
    }
    case "number": {
      const el = h("input", { ...common, type: "number", step: "any" });
      el.value = value === 0 ? 0 : (value || "");
      return el;
    }
    case "date": {
      const el = h("input", { ...common, type: "date" });
      el.value = value || "";
      return el;
    }
    case "email": {
      const el = h("input", { ...common, type: "email", placeholder: "name@example.com" });
      el.value = value || "";
      return el;
    }
    case "phone": {
      const el = h("input", { ...common, type: "tel", placeholder: "08X-XXX-XXXX" });
      el.value = value || "";
      return el;
    }
    case "url": {
      const el = h("input", { ...common, type: "url", placeholder: "https://" });
      el.value = value || "";
      return el;
    }
    default: {
      const el = h("input", { ...common, type: "text" });
      el.value = value || "";
      return el;
    }
  }
}

/* ================= field settings ================= */
function viewSettings() {
  const rows = state.schema.fields.map((f, i) => h("div", { class: "field-def-row" },
    h("div", { class: "drag-handle" }, "⠿"),
    h("div", {},
      h("div", { style: { fontWeight: "600" } }, f.label, f.required ? h("span", { class: "req", style: { color: "var(--danger)" } }, " *") : null),
      h("div", { class: "fd-key" }, f.key)
    ),
    h("div", { class: "fd-type" }, (window.CMRSeed.FIELD_TYPES[f.type] || f.type) + ((f.options || []).length ? ` (${f.options.length} ตัวเลือก)` : "")),
    h("div", { class: "fd-type" }, f.system ? "ระบบ" : "กำหนดเอง"),
    h("div", { class: "fd-actions" },
      h("button", { class: "icon-btn", title: "เลื่อนขึ้น", disabled: i === 0 || f.system, onclick: () => moveField(i, -1) }, "↑"),
      h("button", { class: "icon-btn", title: "เลื่อนลง", disabled: i === state.schema.fields.length - 1 || f.system, onclick: () => moveField(i, 1) }, "↓"),
      h("button", { class: "icon-btn", title: "แก้ไข", onclick: () => openFieldModal(f) }, "✎"),
      h("button", { class: "icon-btn danger", title: "ลบ", disabled: f.system, onclick: () => removeField(f) }, "🗑")
    )
  ));

  return h("div", {},
    topbar({
      title: "ตั้งค่าฟิลด์",
      sub: "กำหนดรูปแบบข้อมูลลูกค้าได้เอง เหมือนการตั้งค่า App บน kintone",
      right: [
        h("button", { class: "btn primary", onclick: () => openFieldModal(null) }, "+ เพิ่มฟิลด์")
      ]
    }),
    h("div", { class: "page" },
      h("div", { class: "card" },
        h("div", { class: "card-head" },
          "ฟิลด์ทั้งหมด (" + state.schema.fields.length + ")",
          h("span", { class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } },
            "ฟิลด์สถานะใช้เป็นคอลัมน์ของมุมมองสถานะ")
        ),
        rows
      ),
      h("div", { class: "card mt16" },
        h("div", { class: "card-head" }, "การจัดการข้อมูล"),
        h("div", { class: "card-body row" },
          h("button", { class: "btn", onclick: exportCsv }, "ส่งออก CSV ทั้งหมด"),
          perms().canImport ? h("button", { class: "btn", onclick: () => $("#csv-file-input").click() }, "นำเข้า CSV") : null,
          h("button", { class: "btn", onclick: downloadTemplate }, "ดาวน์โหลดแม่แบบ CSV")
        )
      )
    )
  );
}

async function moveField(index, delta) {
  const fields = state.schema.fields;
  const target = index + delta;
  if (target < 0 || target >= fields.length) return;
  if (fields[index].system || fields[target].system) return;
  [fields[index], fields[target]] = [fields[target], fields[index]];
  await saveSchema();
}

async function removeField(field) {
  const ok = await confirmDialog(`ลบฟิลด์ "${field.label}"? ข้อมูลในฟิลด์นี้จะถูกลบจากทุกระเบียน`, { danger: true, okText: "ลบฟิลด์" });
  if (!ok) return;
  state.schema.fields = state.schema.fields.filter((f) => f.key !== field.key);
  await saveSchema();
}

async function saveSchema() {
  try {
    showLoading();
    state.schema = await store.saveSchema(state.schema);
    await reload();
    hideLoading();
    toast("บันทึกโครงสร้างฟิลด์แล้ว", "success");
    render();
  } catch (e) {
    hideLoading();
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
}

function slugKey(label, existing) {
  const latin = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  let base = latin && /[a-z]/.test(latin) ? latin : "field";
  let key = base;
  let n = 2;
  const taken = new Set(existing.map((f) => f.key));
  while (taken.has(key)) key = base + "_" + n++;
  return key;
}

function openFieldModal(field) {
  const editing = !!field;
  const labelInput = h("input", { type: "text", placeholder: "เช่น ชื่อโครงการ" });
  labelInput.value = editing ? field.label : "";

  const typeSel = h("select", {},
    Object.entries(window.CMRSeed.FIELD_TYPES).map(([k, v]) => h("option", { value: k }, v))
  );
  typeSel.value = editing ? field.type : "text";
  if (editing && field.system) typeSel.disabled = true;

  const optionsArea = h("textarea", {
    rows: "3",
    placeholder: "คั่นด้วยเครื่องหมายจุลภาค เช่น แบรนด์ A, แบรนด์ B"
  });
  optionsArea.value = editing && field.options ? field.options.join(", ") : "";

  const reqWrap = h("label", { style: { display: "flex", gap: "7px", alignItems: "center", fontWeight: "400" } });
  const reqBox = h("input", { type: "checkbox" });
  reqBox.checked = editing ? !!field.required : false;
  reqWrap.append(reqBox, " จำเป็นต้องกรอก (บังคับ)");

  const optionsBlock = h("div", { class: "form-field", style: { display: "none" } },
    h("label", {}, "ตัวเลือก (คั่นด้วย ,)"), optionsArea
  );

  const syncOptions = () => {
    optionsBlock.style.display = ["select", "status", "checkbox"].includes(typeSel.value) ? "block" : "none";
  };
  typeSel.addEventListener("change", syncOptions);
  syncOptions();

  const body = h("div", {},
    h("div", { class: "form-field" }, h("label", {}, "ชื่อฟิลด์"), labelInput),
    h("div", { class: "form-field" }, h("label", {}, "ชนิดข้อมูล"), typeSel),
    optionsBlock,
    h("div", { class: "form-field" }, reqWrap)
  );

  openModal({
    title: editing ? "แก้ไขฟิลด์" : "เพิ่มฟิลด์ใหม่",
    body,
    footer: [
      h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
      h("button", {
        class: "btn primary",
        onclick: async () => {
          const label = labelInput.value.trim();
          if (!label) { toast("กรุณาตั้งชื่อฟิลด์", "error"); labelInput.classList.add("err"); return; }
          const type = typeSel.value;
          const options = optionsArea.value.split(",").map((s) => s.trim()).filter(Boolean);
          if (["select", "status", "checkbox"].includes(type) && !options.length) {
            toast("กรุณาระบุตัวเลือกอย่างน้อย 1 รายการ", "error");
            optionsArea.classList.add("err");
            return;
          }

          if (editing) {
            field.label = label;
            if (!field.system) field.type = type;
            if (["select", "status", "checkbox"].includes(field.type)) field.options = options;
            field.required = reqBox.checked;
          } else {
            state.schema.fields.push({
              key: slugKey(label, state.schema.fields),
              label, type, required: reqBox.checked, system: false,
              options: ["select", "status", "checkbox"].includes(type) ? options : undefined
            });
          }
          closeModal();
          await saveSchema();
        }
      }, "บันทึก")
    ]
  });
}

/* ================= CSV ================= */
function csvRows() {
  const fields = state.schema.fields;
  const header = fields.map((f) => f.label);
  const rows = state.records.map((rec) => fields.map((f) => {
    const v = rec.values[f.key];
    if (Array.isArray(v)) return v.join("|");
    if (v === null || v === undefined) return "";
    return v;
  }));
  return [header, ...rows];
}

function exportCsv() {
  if (!state.records.length) { toast("ยังไม่มีข้อมูลให้ส่งออก", "error"); return; }
  CSV.download("cmr-customers-" + new Date().toISOString().slice(0, 10) + ".csv", CSV.stringify(csvRows()));
  toast("ส่งออก CSV แล้ว (" + state.records.length + " ระเบียน)", "success");
}

function downloadTemplate() {
  const fields = state.schema.fields;
  const sample = fields.map((f) => {
    if (f.type === "status") return (f.options || [])[0] || "";
    if (f.type === "select") return (f.options || [])[0] || "";
    return "";
  });
  CSV.download("cmr-template.csv", CSV.stringify([fields.map((f) => f.label), sample]));
  toast("ดาวน์โหลดแม่แบบแล้ว", "success");
}

async function handleCsvFile(file) {
  try {
    const text = await file.text();
    const rows = CSV.parse(text);
    if (rows.length < 2) { toast("ไฟล์ไม่มีข้อมูล", "error"); return; }

    const header = rows[0].map((s) => String(s).trim());
    const fields = state.schema.fields;
    const mapping = header.map((hLabel) =>
      fields.find((f) => f.label === hLabel) || fields.find((f) => f.key === hLabel) || null
    );
    const matched = mapping.filter(Boolean).length;
    if (!matched) {
      toast("ไม่พบคอลัมน์ที่ตรงกับฟิลด์ในระบบ", "error");
      return;
    }

    const dataRows = rows.slice(1);
    const previewHead = h("thead", {}, h("tr", {},
      mapping.map((f, i) => h("th", {}, f ? f.label + " ✓" : (header[i] || "") + " ✗"))
    ));
    const previewRows = dataRows.slice(0, 5).map((r) =>
      h("tr", {}, r.map((c) => h("td", {}, String(c))))
    );
    const previewBody = h("tbody", {}, previewRows);
    const previewTable = h("table", { class: "data" }, previewHead, previewBody);

    openModal({
      title: "นำเข้า CSV",
      wide: true,
      body: h("div", {},
        h("p", {}, `ไฟล์: ${file.name} · พบ ${dataRows.length} แถวข้อมูล · จับคู่คอลัมน์ได้ ${matched} จาก ${header.length} คอลัมน์`),
        h("div", { class: "table-wrap", style: { maxHeight: "300px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" } }, previewTable),
        h("p", { class: "small muted" }, "แสดงตัวอย่าง 5 แถวแรก · แถวที่ไม่ครบฟิลด์ที่จำเป็นจะถูกข้าม")
      ),
      footer: [
        h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
        h("button", {
          class: "btn primary",
          onclick: async () => {
            closeModal();
            await importRows(mapping, dataRows);
          }
        }, "นำเข้า " + dataRows.length + " แถว")
      ]
    });
  } catch (e) {
    toast("อ่านไฟล์ไม่สำเร็จ: " + e.message, "error");
  }
}

async function importRows(mapping, dataRows) {
  const fields = state.schema.fields;
  let ok = 0, skipped = 0;
  showLoading();
  for (const row of dataRows) {
    const values = {};
    let valid = true;
    fields.forEach((f) => { values[f.key] = f.type === "checkbox" ? [] : ""; });
    mapping.forEach((f, i) => {
      if (!f) return;
      let v = (row[i] ?? "").toString().trim();
      if (f.type === "checkbox") v = v ? v.split("|").map((s) => s.trim()).filter(Boolean) : [];
      if (f.type === "number" && v !== "") v = isNaN(Number(v)) ? "" : Number(v);
      values[f.key] = v;
    });
    for (const f of fields) {
      if (f.required && isEmpty(values[f.key])) { valid = false; break; }
    }
    if (!valid) { skipped++; continue; }
    try {
      await store.createRecord(values);
      ok++;
    } catch (e) { skipped++; }
  }
  await reload();
  hideLoading();
  toast(`นำเข้าสำเร็จ ${ok} ระเบียน${skipped ? ` · ข้าม ${skipped} แถว` : ""}`, skipped ? "" : "success");
  route();
}

/* ================= auth views ================= */
/* ---------- ภาษาหน้าเข้าสู่ระบบ (th / en / zh) ---------- */
const AUTH_LANGS = ["th", "en", "zh"];
const AUTH_LANG_NAME = { th: "ไทย", en: "English", zh: "中文" };
const AUTH_LANG_SHORT = { th: "ไทย", en: "EN", zh: "中文" };
const DEFAULT_DOC_TITLE = "Qwikflow CRM — ระบบจัดการลูกค้า";
const AUTH_I18N = {
  th: {
    docTitle: DEFAULT_DOC_TITLE,
    brandSub: "ระบบจัดการลูกค้า",
    title: "เข้าสู่ระบบ",
    sub: "กรอกชื่อผู้ใช้และรหัสผ่านเพื่อใช้งานระบบ",
    username: "ชื่อผู้ใช้",
    password: "รหัสผ่าน",
    submit: "เข้าสู่ระบบ",
    fillBoth: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน",
    welcome: "เข้าสู่ระบบสำเร็จ สวัสดี ",
    sessionExpired: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
    errors: {
      "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
      "บัญชีนี้ถูกระงับการใช้งาน": "บัญชีนี้ถูกระงับการใช้งาน",
      "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้": "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"
    }
  },
  en: {
    docTitle: "Qwikflow CRM — Customer Management",
    brandSub: "Customer Management",
    title: "Sign in",
    sub: "Enter your username and password to continue",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    fillBoth: "Please enter username and password",
    welcome: "Signed in — welcome, ",
    sessionExpired: "Session expired. Please sign in again.",
    errors: {
      "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง": "Incorrect username or password",
      "บัญชีนี้ถูกระงับการใช้งาน": "This account has been suspended",
      "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้": "Cannot connect to the server"
    }
  },
  zh: {
    docTitle: "Qwikflow CRM — 客户管理系统",
    brandSub: "客户管理系统",
    title: "登录",
    sub: "请输入用户名和密码以使用系统",
    username: "用户名",
    password: "密码",
    submit: "登录",
    fillBoth: "请输入用户名和密码",
    welcome: "登录成功，欢迎您 ",
    sessionExpired: "登录已过期，请重新登录",
    errors: {
      "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง": "用户名或密码不正确",
      "บัญชีนี้ถูกระงับการใช้งาน": "该账户已被停用",
      "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้": "无法连接服务器"
    }
  }
};

function authLang() {
  const saved = localStorage.getItem("cmr_lang");
  return AUTH_LANGS.includes(saved) ? saved : "th";
}
function tA(key) { return (AUTH_I18N[authLang()] || AUTH_I18N.th)[key]; }
/** แปลข้อความ error ที่เซิร์ฟเวอร์ส่งมาเป็นภาษาไทย ตามภาษาที่ผู้ใช้เลือก */
function tAuthErr(msg) {
  const map = (AUTH_I18N[authLang()] || AUTH_I18N.th).errors;
  return map[msg] || msg;
}

/** ปุ่มเมนูสลับภาษา (ไทย / English / 中文) — ใช้บนหน้า Login */
let openLangMenu = null;
document.addEventListener("click", () => {
  if (openLangMenu) { openLangMenu.hidden = true; openLangMenu = null; }
});
function langMenu() {
  const cur = authLang();
  const menu = h("div", { class: "lang-menu", hidden: true },
    AUTH_LANGS.map((code) => h("button", {
      class: "lang-item" + (code === cur ? " active" : ""), type: "button",
      onclick: (e) => {
        e.stopPropagation();
        localStorage.setItem("cmr_lang", code);
        openLangMenu = null;
        render();
      }
    }, AUTH_LANG_NAME[code]))
  );
  const btn = h("button", { class: "lang-btn", type: "button", title: "Language / ภาษา" },
    "🌐 " + AUTH_LANG_SHORT[cur]);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    openLangMenu = menu.hidden ? null : menu;
  });
  return h("div", { class: "lang-switch" }, btn, menu);
}

function authShell(title, sub, form, footerNote) {
  return h("div", { class: "auth-page" },
    h("div", { class: "auth-card card" },
      langMenu(),
      h("div", { class: "auth-brand" },
        h("div", { class: "brand-mark" }),
        h("div", {}, h("strong", {}, "Qwikflow CRM"), h("span", {}, tA("brandSub")))
      ),
      h("h2", {}, title),
      p2(sub),
      form,
      footerNote ? h("div", { class: "auth-foot" }, footerNote) : null
    )
  );
}

function p2(text) { return h("p", { class: "auth-sub muted" }, text); }

function authField(label, inputEl, hint) {
  return h("div", { class: "form-field" },
    h("label", {}, label), inputEl,
    hint ? h("div", { class: "hint" }, hint) : null
  );
}

function authErrorBox() {
  return h("div", { class: "form-error", hidden: true });
}

function showAuthError(box, msg) {
  box.textContent = msg;
  box.hidden = !msg;
}

function viewLogin() {
  const userInp = h("input", { type: "text", autocomplete: "username", placeholder: tA("username"), required: true });
  const passInp = h("input", { type: "password", autocomplete: "current-password", placeholder: tA("password"), required: true });
  const err = authErrorBox();
  const submit = h("button", { class: "btn primary block", type: "submit" }, tA("submit"));

  const form = h("form", { class: "auth-form", onsubmit: async (e) => {
    e.preventDefault();
    showAuthError(err, "");
    if (!userInp.value.trim() || !passInp.value) { showAuthError(err, tA("fillBoth")); return; }
    submit.disabled = true;
    try {
      state.user = await Auth.login(userInp.value.trim(), passInp.value);
      await loadData();
      toast(tA("welcome") + state.user.display_name, "success");
      go("#/dashboard");
    } catch (ex) {
      showAuthError(err, tAuthErr(ex.message));
    } finally {
      submit.disabled = false;
    }
  } },
    authField(tA("username"), userInp),
    authField(tA("password"), passInp),
    err,
    submit
  );

  return authShell(tA("title"), tA("sub"), form);
}

/* ================= users view (admin) ================= */
/** สร้าง element รูปโปรไฟล์ผู้ใช้ (มีรูป = แสดงภาพ, ไม่มี = ตัวอักษรย่อ) */
function userAvatar(u, sizeClass = "") {
  const cls = "avatar" + (sizeClass ? " " + sizeClass : "") + (u && u.avatar ? " has-img" : "");
  const el = h("div", { class: cls }, u && u.avatar ? "" : initials(u && u.display_name));
  if (u && u.avatar) el.style.backgroundImage = `url("${u.avatar}")`;
  return el;
}

function viewUsers() {
  const tableBox = h("div");

  /** ย่อรูปเป็น data URL (最长 960px, jpeg 0.82) เพื่อให้ base64 ไม่เกิน 1 MB */
  const compressImage = (file, maxDim = 960, quality = 0.82) => new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith("image/")) { reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพ")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const hh = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = hh;
      c.getContext("2d").drawImage(img, 0, 0, w, hh);
      let out = c.toDataURL("image/jpeg", quality);
      if (out.length > 1400000) out = c.toDataURL("image/jpeg", quality - 0.15);
      if (out.length > 1400000) { reject(new Error("รูปใหญ่เกินไป (สูงสุด 1 MB)")); return; }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("เปิดไฟล์รูปไม่ได้")); };
    img.src = url;
  });

  const load = async () => {
    try {
      const users = await Auth.listUsers();
      fill(tableBox, usersTable(users));
    } catch (e) { toast(e.message, "error"); }
  };

  const usersTable = (users) => {
    if (!users.length) return h("div", { class: "empty" }, h("p", {}, "ยังไม่มีผู้ใช้"));
    return h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {},
        ["ชื่อผู้ใช้", "ชื่อที่แสดง", "อีเมล", "บทบาท", "สถานะ", "ระเบียนที่สร้าง", "รูปปก", "จัดการ"].map((t) => h("th", {}, t))
      )),
      h("tbody", {}, users.map((u) => {
        const isSelf = state.user && u.id === state.user.id;

        const roleSel = h("select", { class: "control sm", disabled: isSelf, onchange: async (e) => {
          const role = e.target.value;
          try {
            await Auth.updateUser(u.id, { role });
            toast(`เปลี่ยนบทบาท ${u.display_name} → ${ROLE_LABEL_TH[role]}`, "success");
            await load();
          } catch (ex) { toast(ex.message, "error"); e.target.value = u.role; }
        } }, Object.entries(ROLE_LABEL_TH).map(([k, v]) => h("option", { value: k }, v)));
        roleSel.value = u.role;

        /* ----- รูปหน้าปก (อัปโหลด/เปลี่ยน/ลบ) ----- */
        const saveAvatar = async (dataUrl) => {
          try {
            const res = await Auth.updateUser(u.id, { avatar: dataUrl });
            if (state.user && state.user.id === u.id) {
              state.user.avatar = res.user.avatar;
              Auth.user = res.user;
              updateChrome();
            }
            toast(dataUrl ? "อัปโหลดรูปหน้าปกแล้ว" : "ลบรูปหน้าปกแล้ว", "success");
            await load();
          } catch (ex) { toast(ex.message, "error"); }
        };
        const fileInp = h("input", { type: "file", accept: "image/*", style: { display: "none" } });
        fileInp.addEventListener("change", async () => {
          const f = fileInp.files && fileInp.files[0];
          fileInp.value = "";
          if (!f) return;
          try { await saveAvatar(await compressImage(f)); }
          catch (ex) { toast(ex.message, "error"); }
        });

        return h("tr", {},
          h("td", { class: "primary-cell" }, u.username, isSelf ? h("span", { class: "tag" }, "คุณ") : null),
          h("td", {}, h("div", { class: "row" }, userAvatar(u), u.display_name)),
          h("td", { class: "muted" }, u.email || "—"),
          h("td", {}, roleSel),
          h("td", {}, h("span", { class: "pill " + (u.active ? "s-won" : "s-lost") }, u.active ? "ใช้งาน" : "ระงับ")),
          h("td", { class: "num" }, u.record_count || 0),
          h("td", {}, h("div", { class: "row" },
            fileInp,
            userAvatar(u, "lg"),
            h("button", { class: "btn sm", onclick: () => fileInp.click() }, u.avatar ? "เปลี่ยนรูป" : "อัปโหลด"),
            u.avatar ? h("button", { class: "btn sm danger", onclick: () => saveAvatar(null) }, "ลบรูป") : null
          )),
          h("td", {}, h("div", { class: "row" },
            h("button", { class: "btn sm", onclick: () => openPasswordModal(u) }, "รหัสผ่าน"),
            h("button", { class: "btn sm", disabled: isSelf, onclick: async () => {
              try {
                await Auth.updateUser(u.id, { active: !u.active });
                toast(u.active ? "ระงับบัญชีแล้ว (เด้งออกจากระบบทันที)" : "เปิดใช้งานบัญชีแล้ว", "success");
                await load();
              } catch (ex) { toast(ex.message, "error"); }
            } }, u.active ? "ระงับ" : "เปิดใช้งาน"),
            h("button", { class: "btn sm danger", disabled: isSelf, onclick: async () => {
              const ok = await confirmDialog(`ลบบัญชี "${u.display_name}"? ระเบียนที่เคยสร้างจะกลายเป็นของระบบ`, { danger: true, okText: "ลบบัญชี" });
              if (!ok) return;
              try { await Auth.deleteUser(u.id); toast("ลบบัญชีแล้ว", "success"); await load(); }
              catch (ex) { toast(ex.message, "error"); }
            } }, "ลบ")
          ))
        );
      }))
    ));
  };

  const openPasswordModal = (u) => {
    const passInp = h("input", { type: "password", placeholder: "รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร" });
    const err = authErrorBox();
    openModal({
      title: `เปลี่ยนรหัสผ่าน: ${u.display_name}`,
      body: h("div", {},
        h("p", { class: "muted small" }, "การเปลี่ยนรหัสผ่านจะออกจากระบบของผู้ใช้คนนั้นทุกเครื่องทันที"),
        authField("รหัสผ่านใหม่", passInp), err
      ),
      footer: [
        h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
        h("button", { class: "btn primary", onclick: async () => {
          showAuthError(err, "");
          try {
            await Auth.updateUser(u.id, { password: passInp.value });
            closeModal();
            toast("เปลี่ยนรหัสผ่านแล้ว", "success");
          } catch (ex) { showAuthError(err, ex.message); }
        } }, "บันทึกรหัสผ่าน")
      ]
    });
  };

  const openAdd = () => {
    const userInp = h("input", { type: "text", placeholder: "a-z, 0-9, . _ -" });
    const nameInp = h("input", { type: "text", placeholder: "ชื่อ-นามสกุล" });
    const emailInp = h("input", { type: "email", placeholder: "name@example.com" });
    const passInp = h("input", { type: "password", placeholder: "อย่างน้อย 6 ตัวอักษร" });
    const roleSel = h("select", {}, Object.entries(ROLE_LABEL_TH).map(([k, v]) => h("option", { value: k }, v)));
    roleSel.value = "member";
    const err = authErrorBox();

    openModal({
      title: "เพิ่มผู้ใช้ใหม่",
      body: h("div", {},
        authField("ชื่อผู้ใช้", userInp),
        authField("ชื่อที่แสดง", nameInp),
        authField("อีเมล", emailInp),
        authField("รหัสผ่าน", passInp),
        authField("บทบาท", roleSel),
        err
      ),
      footer: [
        h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
        h("button", { class: "btn primary", onclick: async () => {
          showAuthError(err, "");
          try {
            await Auth.createUser({
              username: userInp.value.trim().toLowerCase(),
              display_name: nameInp.value.trim(),
              email: emailInp.value.trim(),
              password: passInp.value,
              role: roleSel.value
            });
            closeModal();
            toast("เพิ่มผู้ใช้แล้ว", "success");
            await load();
          } catch (ex) { showAuthError(err, ex.message); }
        } }, "เพิ่มผู้ใช้")
      ]
    });
  };

  load();

  return h("div", {},
    topbar({
      title: "จัดการผู้ใช้",
      sub: "กำหนดบทบาทและสิทธิ์การเข้าถึงข้อมูลลูกค้า",
      right: [h("button", { class: "btn primary", onclick: openAdd }, "+ เพิ่มผู้ใช้")]
    }),
    h("div", { class: "page" },
      h("div", { class: "card" },
        h("div", { class: "card-head" }, "ผู้ใช้ในระบบ",
          h("span", { class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } },
            "admin ทำได้ทุกอย่าง · member เพิ่ม/แก้ไขได้ · viewer อ่านอย่างเดียว")),
        tableBox
      )
    )
  );
}

const ROLE_LABEL_TH = { admin: "ผู้ดูแลระบบ", member: "สมาชิก", viewer: "ผู้ชม (อ่านอย่างเดียว)" };

/* ================= start ================= */
let booted = false;
async function bootOnce() { if (booted) return; booted = true; await boot(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootOnce);
else bootOnce();
