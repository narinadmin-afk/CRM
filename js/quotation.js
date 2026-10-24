/* ============================================================
   CMR Base — โมดูลใบเสนอราคา (Quotation Management)
   หน้าทั้งหมด: ภาพรวม / รายการ / ฟอร์มสร้าง-แก้ไข / รายละเอียด /
   ตัวอย่างเอกสาร A4 + พิมพ์ / ตั้งค่าเอกสาร / คลังสินค้า
   ข้อมูลทุกอย่างมาจาก REST API ของ server.js (MySQL จริง)
   สิทธิ์บังคับทั้งฝั่งเซิร์ฟเวอร์และฝั่ง UI (perms())
   ============================================================ */

/* ---------------- state ของโมดูล ---------------- */
const quoListState = {
  q: "", status: "", from: "", to: "",
  page: 1, per_page: 15, sort: "updated_at", dir: "desc"
};

/* ---------------- API ---------------- */
const QuoApi = {
  list(params = {}) {
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qp.set(k, v);
    }
    const s = qp.toString();
    return apiFetch("GET", "/api/quotations" + (s ? "?" + s : ""));
  },
  stats() { return apiFetch("GET", "/api/quotations/stats"); },
  get(id) { return apiFetch("GET", "/api/quotations/" + encodeURIComponent(id)); },
  create(doc) { return apiFetch("POST", "/api/quotations", doc); },
  update(id, doc) { return apiFetch("PUT", "/api/quotations/" + encodeURIComponent(id), doc); },
  setStatus(id, status) { return apiFetch("POST", "/api/quotations/" + encodeURIComponent(id) + "/status", { status }); },
  duplicate(id) { return apiFetch("POST", "/api/quotations/" + encodeURIComponent(id) + "/duplicate"); },
  remove(id) { return apiFetch("DELETE", "/api/quotations/" + encodeURIComponent(id)); },
  products(q = "", active = false) {
    const qp = new URLSearchParams();
    if (q) qp.set("q", q);
    if (active) qp.set("active", "1");
    const s = qp.toString();
    return apiFetch("GET", "/api/products" + (s ? "?" + s : ""));
  },
  saveProduct(p, id) {
    return id
      ? apiFetch("PATCH", "/api/products/" + encodeURIComponent(id), p)
      : apiFetch("POST", "/api/products", p);
  },
  removeProduct(id) { return apiFetch("DELETE", "/api/products/" + encodeURIComponent(id)); },
  getSettings() { return apiFetch("GET", "/api/qsettings"); },
  saveSettings(s) { return apiFetch("PUT", "/api/qsettings", s); }
};

/* ---------------- helpers ---------------- */
function money2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneyB(n) { return money2(n) + " ฿"; }

function quoStatusPill(status) {
  const cls = {
    Draft: "s-lead", Sent: "s-contact", Pending: "s-proposal", Approved: "s-won",
    Rejected: "s-lost", Expired: "s-negotiate", Cancelled: "s-other"
  }[status] || "s-other";
  return h("span", { class: "pill " + cls }, Quo.STATUS_LABELS[status] || status);
}

/** สิทธิ์แก้ไขฝั่ง UI — ตรงกับ canEditQuotation ฝั่งเซิร์ฟเวอร์ */
function quoCanEdit(q) {
  const p = perms();
  if (!p.canWrite || !q) return false;
  if (p.isAdmin) return true;
  const u = state.user;
  if (!u) return false;
  return q.created_by === u.id || q.owner === u.display_name;
}
function quoCanDelete(q) {
  const p = perms();
  if (!p.canWrite || !q) return false;
  if (p.isAdmin) return true;
  const u = state.user;
  return !!u && q.created_by === u.id && q.status !== Quo.STATUS.APPROVED;
}
function quoEditable(q) { return Quo.EDITABLE_STATUSES.includes(q.status); }

function quoEmptyCard(title, desc, actions = []) {
  return h("div", { class: "card empty" },
    h("div", { class: "e-ico" }, "📄"),
    h("h3", {}, title),
    h("p", {}, desc),
    ...actions
  );
}

function quoErrCard(e) {
  return h("div", { class: "card empty" },
    h("div", { class: "e-ico" }, "⚠️"),
    h("h3", {}, "เปิดข้อมูลไม่สำเร็จ"),
    h("p", {}, e.message || String(e))
  );
}

/* ============================================================
   1) ภาพรวมใบเสนอราคา (Dashboard)
   ============================================================ */
function viewQuotations() {
  const root = h("div", {});

  root.append(
    topbar({
      title: "ภาพรวมใบเสนอราคา",
      sub: "สถิติและเอกสารล่าสุด · อัปเดต " + fmtDateTime(Date.now())
    }),
    h("div", { class: "page", id: "quo-overview-body" },
      h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลดข้อมูล…")))
  );

  (async () => {
    const box = root.querySelector("#quo-overview-body");
    try {
      const [stats, recent] = await Promise.all([
        QuoApi.stats(),
        QuoApi.list({ sort: "updated_at", dir: "desc", per_page: 8, page: 1 })
      ]);
      if (!box) return;

      const kpis = h("div", { class: "kpi-grid kpi8" },
        kpi("ใบเสนอราคาทั้งหมด", fmtNumber(stats.total_documents), "ทุกสถานะ", ""),
        kpi("ฉบับร่าง", fmtNumber(stats.counts.Draft || 0), "ยังไม่ส่ง", ""),
        kpi("ส่งให้ลูกค้าแล้ว", fmtNumber(stats.counts.Sent || 0), "รอส่ง/ส่งแล้ว", "cyan"),
        kpi("ได้รับอนุมัติ", fmtNumber(stats.counts.Approved || 0), "ปิดการขายแล้ว", "green"),
        kpi("รอการตอบรับ", fmtNumber(stats.pending_count || 0), "Pending", "amber"),
        kpi("หมดอายุ", fmtNumber(stats.counts.Expired || 0), "เลยกำหนด", "amber"),
        kpi("มูลค่ารวม", moneyB(stats.total_value), "ยกเว้นเอกสารยกเลิก", "cyan"),
        kpi("มูลค่าที่อนุมัติ", moneyB(stats.approved_value), "Approved", "green")
      );

      const statusRow = Quo.STATUS_ORDER.map((s) =>
        h("div", { class: "bar-row" },
          h("div", { class: "bar-label" }, Quo.STATUS_LABELS[s]),
          h("div", { class: "bar-track" },
            h("div", { class: "bar-fill", style: { width: ((stats.counts[s] || 0) / Math.max(1, stats.total_documents) * 100) + "%" } })),
          h("div", { class: "bar-value" }, stats.counts[s] || 0)
        ));

      const recentTable = recent.items.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "data" },
            h("thead", {}, h("tr", {},
              ["เลขที่ใบเสนอราคา", "ชื่อลูกค้า", "วันที่ออก", "วันหมดอายุ", "มูลค่ารวม", "สถานะ", "ผู้รับผิดชอบ"]
                .map((t, i) => h("th", { class: i === 4 ? "num" : "" }, t)))),
            h("tbody", {}, recent.items.map((q) => h("tr", { style: { cursor: "pointer" }, onclick: () => go("#/quotation/" + q.id) },
              h("td", { class: "primary-cell mono" }, q.quotation_number),
              h("td", {}, q.customer_name),
              h("td", {}, fmtDate(q.issue_date)),
              h("td", {}, q.expiry_date ? fmtDate(q.expiry_date) : "—"),
              h("td", { class: "num" }, moneyB(q.grand_total)),
              h("td", {}, quoStatusPill(q.status)),
              h("td", {}, q.owner || "—")
            )))))
        : h("p", { class: "muted mb0" }, "ยังไม่มีใบเสนอราคา — ใช้เมนู “+ สร้างใหม่” ในเมนูย่อยด้านซ้ายเพื่อเริ่มต้น");

      fill(box,
        kpis,
        h("div", { class: "dash-grid", style: { marginTop: "16px" } },
          h("div", {}, h("div", { class: "card" },
            h("div", { class: "card-head" }, "ใบเสนอราคาล่าสุด",
              h("a", { href: "#/quotations/list", class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } }, "ดูทั้งหมด →")),
            h("div", { class: "card-body" }, recentTable))),
          h("div", {}, h("div", { class: "card" },
            h("div", { class: "card-head" }, "สถิติตามสถานะ"),
            h("div", { class: "card-body" }, statusRow,
              h("div", { class: "small muted mt16" },
                "มูลค่ารวมตามสถานะ: " + Quo.STATUS_ORDER.map((s) => `${Quo.STATUS_LABELS[s]} ${fmtMoney(stats.values[s] || 0)}`).join(" · ")))))
        )
      );
    } catch (e) {
      const box2 = root.querySelector("#quo-overview-body");
      if (box2) fill(box2, quoErrCard(e));
    }
  })();

  return root;
}

/* ============================================================
   2) รายการใบเสนอราคาทั้งหมด (ตาราง + ค้นหา/กรอง/เรียง/แบ่งหน้า)
   ============================================================ */
function viewQuotationsList(query) {
  if (query && query.status !== undefined && query.status !== quoListState.__lastQueryStatus) {
    quoListState.status = query.status || "";
    quoListState.page = 1;
    quoListState.__lastQueryStatus = query.status || "";
  }

  const body = h("div", { id: "quo-list-body" }, h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลด…")));

  const searchInput = h("input", {
    type: "search", placeholder: "ค้นหาเลขที่เอกสาร / ชื่อลูกค้า…",
    value: quoListState.q,
    oninput: debounce((e) => { quoListState.q = e.target.value; quoListState.page = 1; loadQuoList(body); }, 250)
  });

  const statusSel = selectControl(quoListState.status,
    ["ทุกสถานะ", ...Quo.STATUS_ORDER.map((s) => s + " · " + Quo.STATUS_LABELS[s])], (v) => {
      quoListState.status = v.startsWith("ทุกสถานะ") ? "" : v.split(" · ")[0];
      quoListState.page = 1;
      loadQuoList(body);
    });
  statusSel.value = quoListState.status
    ? quoListState.status + " · " + Quo.STATUS_LABELS[quoListState.status]
    : "ทุกสถานะ";

  const fromInp = h("input", { type: "date", class: "control", value: quoListState.from, onchange: (e) => { quoListState.from = e.target.value; quoListState.page = 1; loadQuoList(body); } });
  const toInp = h("input", { type: "date", class: "control", value: quoListState.to, onchange: (e) => { quoListState.to = e.target.value; quoListState.page = 1; loadQuoList(body); } });

  const controls = h("div", { class: "row", style: { flexWrap: "wrap" } },
    h("div", { class: "search-box" }, searchInput),
    statusSel,
    h("span", { class: "muted small" }, "วันที่ออก"),
    fromInp, toInp,
    (quoListState.q || quoListState.status || quoListState.from || quoListState.to)
      ? h("button", { class: "btn sm", onclick: () => {
          quoListState.q = ""; quoListState.status = ""; quoListState.from = ""; quoListState.to = ""; quoListState.page = 1;
          render();
        } }, "ล้างตัวกรอง")
      : null
  );

  loadQuoList(body);

  return h("div", {},
    topbar({
      title: "รายการใบเสนอราคา",
      sub: "ค้นหา เรียงลำดับ และจัดการเอกสารทั้งหมด",
      right: [controls]
    }),
    h("div", { class: "page" }, body)
  );
}

async function loadQuoList(bodyEl) {
  const root = bodyEl || document.getElementById("quo-list-body");
  if (!root) return;
  fill(root, h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลด…")));
  try {
    const data = await QuoApi.list({
      q: quoListState.q, status: quoListState.status,
      from: quoListState.from, to: quoListState.to,
      sort: quoListState.sort, dir: quoListState.dir,
      page: quoListState.page, per_page: quoListState.per_page
    });
    fill(root, quoListTable(data));
  } catch (e) {
    fill(root, quoErrCard(e));
  }
}

function quoListTable(data) {
  const frag = document.createDocumentFragment();
  const filtering = quoListState.q || quoListState.status || quoListState.from || quoListState.to;
  const totalPages = Math.max(1, Math.ceil(data.total / data.per_page));

  frag.append(h("div", { class: "row spread", style: { marginBottom: "10px" } },
    h("div", { class: "muted small" }, `แสดง ${data.items.length} จาก ${data.total} ฉบับ · หน้า ${data.page}/${totalPages}`)
  ));

  if (!data.items.length) {
    frag.append(quoEmptyCard(
      filtering ? "ไม่พบเอกสารที่ค้นหา" : "ยังไม่มีใบเสนอราคา",
      filtering ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง" : "เริ่มต้นได้จากเมนู “+ สร้างใหม่” ในเมนูย่อยด้านซ้าย"
    ));
    return frag;
  }

  const cols = [
    { key: "quotation_number", label: "เลขที่ใบเสนอราคา" },
    { key: "customer_name", label: "ชื่อลูกค้า" },
    { key: "issue_date", label: "วันที่ออก" },
    { key: "expiry_date", label: "วันหมดอายุ" },
    { key: "grand_total", label: "มูลค่ารวม", num: true },
    { key: "created_by_name", label: "ผู้จัดทำ" },
    { key: "status", label: "สถานะ" },
    { key: "updated_at", label: "แก้ไขล่าสุด" }
  ];

  const table = h("table", { class: "data" },
    h("thead", {}, h("tr", {},
      cols.map((c) => {
        const active = quoListState.sort === c.key;
        return h("th", {
          class: c.num ? "num" : "",
          onclick: () => {
            if (active) quoListState.dir = quoListState.dir === "asc" ? "desc" : "asc";
            else { quoListState.sort = c.key; quoListState.dir = "asc"; }
            loadQuoList();
          }
        }, c.label, active ? h("span", { class: "arrow" }, quoListState.dir === "asc" ? " ▲" : " ▼") : null);
      }),
      h("th", {}, "เมนู")
    )),
    h("tbody", {}, data.items.map((q) => h("tr", {},
      h("td", { class: "primary-cell" },
        h("a", { href: "#/quotation/" + q.id, class: "mono" }, q.quotation_number)),
      h("td", {}, q.customer_name),
      h("td", {}, fmtDate(q.issue_date)),
      h("td", {}, q.expiry_date ? fmtDate(q.expiry_date) : "—"),
      h("td", { class: "num" }, moneyB(q.grand_total)),
      h("td", {}, q.created_by_name || "—"),
      h("td", {}, quoStatusPill(q.status)),
      h("td", { class: "muted small" }, relTime(q.updated_at)),
      h("td", {}, h("div", { class: "row", style: { gap: "4px" } },
        h("button", { class: "btn sm", onclick: () => go("#/quotation/" + q.id) }, "ดู"),
        h("button", { class: "btn sm", onclick: () => openQuoRowMenu(q) }, "⋯")
      ))
    )))
  );

  frag.append(h("div", { class: "card table-wrap" }, table));

  /* แบ่งหน้า */
  frag.append(h("div", { class: "row spread", style: { marginTop: "10px" } },
    h("span", { class: "muted small" }, `หน้า ${data.page} จาก ${totalPages}`),
    h("div", { class: "row" },
      h("button", { class: "btn sm", disabled: data.page <= 1, onclick: () => { quoListState.page--; loadQuoList(); } }, "← ก่อนหน้า"),
      h("button", { class: "btn sm", disabled: data.page >= totalPages, onclick: () => { quoListState.page++; loadQuoList(); } }, "ถัดไป →")
    )
  ));

  return frag;
}

/** เมนูการดำเนินการของแต่ละแถว (ตามสิทธิ์) */
function openQuoRowMenu(q) {
  const items = [];
  items.push(h("button", { class: "btn", onclick: () => { closeModal(); go("#/quotation/" + q.id); } }, "👁 ดูรายละเอียด"));
  if (quoCanEdit(q) && quoEditable(q)) {
    items.push(h("button", { class: "btn", onclick: () => { closeModal(); go("#/quotation/" + q.id + "/edit"); } }, "✎ แก้ไข"));
  }
  if (perms().canWrite) {
    items.push(h("button", { class: "btn", onclick: async () => {
      closeModal();
      try {
        showLoading();
        const created = await QuoApi.duplicate(q.id);
        hideLoading();
        toast("ทำสำเนาเป็น " + created.quotation.quotation_number + " แล้ว", "success");
        go("#/quotation/" + created.quotation.id + "/edit");
      } catch (e) { hideLoading(); toast(e.message, "error"); }
    } }, "⧉ ทำสำเนา"));
  }
  items.push(h("button", { class: "btn", onclick: () => { closeModal(); go("#/quotation/" + q.id + "/print"); } }, "⬇ ดูตัวอย่าง / ดาวน์โหลด PDF"));
  if (quoCanEdit(q) && Quo.canChangeStatus(q.status, Quo.STATUS.CANCELLED)) {
    items.push(h("button", { class: "btn danger", onclick: async () => {
      closeModal();
      const ok2 = await confirmDialog(`ต้องการยกเลิกใบเสนอราคา ${q.quotation_number} ใช่หรือไม่?`, { danger: true, okText: "ยกเลิกเอกสาร" });
      if (!ok2) return;
      try {
        await QuoApi.setStatus(q.id, Quo.STATUS.CANCELLED);
        toast("ยกเลิกเอกสารแล้ว", "success");
        loadQuoList();
      } catch (e) { toast(e.message, "error"); }
    } }, "🚫 ยกเลิกใบเสนอราคา"));
  }
  if (quoCanDelete(q)) {
    items.push(h("button", { class: "btn danger", onclick: async () => {
      closeModal();
      const ok2 = await confirmDialog(`ลบใบเสนอราคา ${q.quotation_number}? การกระทำนี้ไม่สามารถย้อนกลับได้`, { danger: true, okText: "ลบ" });
      if (!ok2) return;
      try {
        await QuoApi.remove(q.id);
        toast("ลบเอกสารแล้ว", "success");
        loadQuoList();
      } catch (e) { toast(e.message, "error"); }
    } }, "🗑 ลบเอกสาร"));
  }

  openModal({
    title: "เมนูการดำเนินการ · " + q.quotation_number,
    body: h("div", { class: "row", style: { flexDirection: "column", alignItems: "stretch", gap: "8px" } }, items),
    footer: [h("button", { class: "btn", onclick: closeModal }, "ปิด")]
  });
}

/* ============================================================
   3) ฟอร์มสร้าง/แก้ไขใบเสนอราคา
   ============================================================ */
function viewQuotationForm(id, query) {
  const editing = !!id;
  const root = h("div", {});
  root.append(h("div", { class: "page" }, h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลด…"))));

  const p = perms();
  if (!p.canWrite) {
    setTimeout(() => toast("บัญชีผู้ชม (viewer) สร้าง/แก้ไขใบเสนอราคาไม่ได้", "error"), 50);
    go("#/quotations/list");
    return root;
  }

  (async () => {
    try {
      showLoading();
      /* ข้อมูลเริ่มต้น: แก้ไข = ดึงเอกสารเดิม · สร้างใหม่ = ค่า default จากตั้งค่าเอกสาร */
      const [settings, products, source] = await Promise.all([
        QuoApi.getSettings(),
        QuoApi.products("", true),
        editing ? QuoApi.get(id) : Promise.resolve(null)
      ]);
      if (editing && quoEditable(source.quotation) === false && !perms().isAdmin) {
        hideLoading();
        toast("เอกสารสถานะนี้แก้ไขไม่ได้ — ใช้การทำสำเนาแทน", "error");
        go("#/quotation/" + id);
        return;
      }
      if (editing && !quoCanEdit(source.quotation)) {
        hideLoading();
        toast("คุณไม่มีสิทธิ์แก้ไขใบเสนอราคาฉบับนี้", "error");
        go("#/quotation/" + id);
        return;
      }
      hideLoading();

      buildQuotationForm(root, {
        editing,
        quotation: editing ? source.quotation : null,
        items: editing ? source.items : [],
        settings, products,
        presetCustomer: (!editing && query && query.customer) ? query.customer : null
      });
    } catch (e) {
      hideLoading();
      fill(root, quoErrCard(e));
    }
  })();

  return root;
}

function buildQuotationForm(root, { editing, quotation, items, settings, products, presetCustomer }) {
  fill(root);

  /* ---------- doc แบบฟอร์ม (เก็บใน memory จนกว่าจะบันทึก) ---------- */
  const today = Quo.todayISO();
  const expiryDefault = (() => {
    const d = new Date(Date.now() + (Number(settings.default_validity_days) || 30) * 864e5);
    return Quo.formatDateISO(d);
  })();
  const doc = editing ? {
    customer_id: quotation.customer_id, customer_name: quotation.customer_name,
    customer_address: quotation.customer_address, customer_tax_id: quotation.customer_tax_id,
    contact_name: quotation.contact_name, contact_email: quotation.contact_email, contact_phone: quotation.contact_phone,
    issue_date: quotation.issue_date, expiry_date: quotation.expiry_date || "",
    tax_mode: quotation.tax_mode, tax_rate: quotation.tax_rate,
    discount_type: quotation.discount_type || "", discount_value: quotation.discount_value,
    payment_terms: quotation.payment_terms, notes: quotation.notes,
    owner: quotation.owner, prepared_by: quotation.prepared_by
  } : {
    customer_id: "", customer_name: "", customer_address: "", customer_tax_id: "",
    contact_name: "", contact_email: "", contact_phone: "",
    issue_date: today, expiry_date: expiryDefault,
    tax_mode: settings.default_tax_mode || "exclusive",
    tax_rate: settings.default_tax_rate === undefined ? 7 : settings.default_tax_rate,
    discount_type: "", discount_value: "",
    payment_terms: settings.default_payment_terms || "", notes: settings.default_notes || "",
    owner: (state.user && state.user.display_name) || "", prepared_by: (state.user && state.user.display_name) || ""
  };
  doc.items = items.length ? items.map((it) => ({ ...it })) : [];

  /* ---------- หัวเอกสาร ---------- */
  const numberBadge = editing
    ? h("span", { class: "mono", style: { fontWeight: "700" } }, quotation.quotation_number)
    : h("span", { class: "muted" }, "ระบบสร้างอัตโนมัติเมื่อบันทึก (เช่น QT-" + new Date().getFullYear() + "-0001)");

  /* ---------- ส่วน 4.1 ข้อมูลเอกสาร ---------- */
  const issueInp = h("input", { type: "date", value: doc.issue_date, onchange: (e) => { doc.issue_date = e.target.value; recalc(); } });
  const expiryInp = h("input", { type: "date", value: doc.expiry_date, onchange: (e) => { doc.expiry_date = e.target.value; } });

  const ownerOptions = [...new Set([...optionsFor("owner"), doc.owner, state.user && state.user.display_name].filter(Boolean))];
  const ownerSel = h("select", { class: "control", onchange: (e) => { doc.owner = e.target.value; } },
    ownerOptions.map((o) => h("option", { value: o }, o)));
  ownerSel.value = doc.owner || "";
  if (doc.owner && !ownerOptions.includes(doc.owner)) ownerSel.prepend(h("option", { value: doc.owner }, doc.owner));

  const preparedSel = h("select", { class: "control", onchange: (e) => { doc.prepared_by = e.target.value; } },
    [...new Set([doc.prepared_by, state.user && state.user.display_name].filter(Boolean))].map((o) => h("option", { value: o }, o)));
  preparedSel.value = doc.prepared_by || "";

  const docCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ข้อมูลเอกสาร"),
    h("div", { class: "card-body" },
      h("div", { class: "form-grid" },
        h("div", { class: "form-field" }, h("label", {}, "เลขที่ใบเสนอราคา"), numberBadge),
        h("div", { class: "form-field" }, h("label", {}, "วันที่ออกใบเสนอราคา"), issueInp),
        h("div", { class: "form-field" }, h("label", {}, "วันที่หมดอายุ"), expiryInp),
        h("div", { class: "form-field" }, h("label", {}, "ผู้จัดทำ"), preparedSel),
        h("div", { class: "form-field" }, h("label", {}, "ผู้รับผิดชอบ"), ownerSel),
        h("div", { class: "form-field" }, h("label", {}, "สถานะเอกสาร"),
          editing ? quoStatusPill(quotation.status) : quoStatusPill("Draft"))
      ))
  );

  /* ---------- ส่วน 4.2 ข้อมูลลูกค้า ---------- */
  const custSummary = h("div", { class: "cust-summary" });
  const custAddr = h("textarea", { rows: "2", onchange: (e) => { doc.customer_address = e.target.value; } });
  custAddr.value = doc.customer_address || "";
  const custTax = h("input", { type: "text", placeholder: "เช่น 0105555000000", onchange: (e) => { doc.customer_tax_id = e.target.value.trim(); } });
  custTax.value = doc.customer_tax_id || "";
  const contactInp = h("input", { type: "text", placeholder: "ชื่อผู้ติดต่อ", onchange: (e) => { doc.contact_name = e.target.value.trim(); } });
  contactInp.value = doc.contact_name || "";
  const contactEmail = h("input", { type: "email", placeholder: "email@example.com", onchange: (e) => { doc.contact_email = e.target.value.trim(); } });
  contactEmail.value = doc.contact_email || "";
  const contactPhone = h("input", { type: "tel", placeholder: "02-xxx-xxxx", onchange: (e) => { doc.contact_phone = e.target.value.trim(); } });
  contactPhone.value = doc.contact_phone || "";

  function renderCustSummary() {
    fill(custSummary,
      doc.customer_name
        ? h("div", {},
            h("strong", {}, doc.customer_name),
            h("div", { class: "muted small" },
              [doc.contact_name && "ติดต่อ: " + doc.contact_name,
               doc.contact_phone && "โทร: " + doc.contact_phone,
               doc.contact_email && doc.contact_email].filter(Boolean).join(" · ") || "—"),
            h("a", { href: "#/record/" + doc.customer_id, class: "small" }, "เปิดหน้าระเบียนลูกค้า →"))
        : h("span", { class: "muted" }, "ยังไม่ได้เลือกลูกค้า")
    );
  }
  renderCustSummary();

  const pickCustBtn = h("button", { class: "btn", onclick: () => openCustomerPicker((rec) => {
    /* ดึงข้อมูลจาก CRM อัตโนมัติ — ไม่สร้างข้อมูลลูกค้าซ้ำ */
    doc.customer_id = rec.id;
    doc.customer_name = rec.values.company || "(ไม่มีชื่อ)";
    doc.customer_address = rec.values.address || "";
    doc.contact_name = rec.values.contact_name || "";
    doc.contact_email = rec.values.email || "";
    doc.contact_phone = rec.values.phone || "";
    custAddr.value = doc.customer_address;
    contactInp.value = doc.contact_name;
    contactEmail.value = doc.contact_email;
    contactPhone.value = doc.contact_phone;
    renderCustSummary();
  }) }, "🔍 เลือกลูกค้าจาก CRM");

  const custCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ข้อมูลลูกค้า",
      h("span", { class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } },
        "ดึงจากระบบ CRM ทันทีที่เลือก · ห้ามสร้างข้อมูลลูกค้าซ้ำ")),
    h("div", { class: "card-body" },
      h("div", { class: "row", style: { marginBottom: "10px" } }, pickCustBtn, custSummary),
      h("div", { class: "form-grid" },
        h("div", { class: "form-field full" }, h("label", {}, "ที่อยู่ลูกค้า"), custAddr),
        h("div", { class: "form-field" }, h("label", {}, "เลขประจำตัวผู้เสียภาษี (ลูกค้า)"), custTax),
        h("div", { class: "form-field" }, h("label", {}, "ผู้ติดต่อ"), contactInp),
        h("div", { class: "form-field" }, h("label", {}, "อีเมลผู้ติดต่อ"), contactEmail),
        h("div", { class: "form-field" }, h("label", {}, "เบอร์โทรศัพท์"), contactPhone)
      ))
  );

  /* ---------- ส่วน 4.3 รายการสินค้า ---------- */
  const itemsBody = h("tbody", {});

  function itemRowEl(it, idx) {
    const qtyInp = h("input", { type: "number", min: "0", step: "any", value: it.quantity, oninput: (e) => { it.quantity = e.target.value; recalc(); } });
    const priceInp = h("input", { type: "number", min: "0", step: "any", value: it.unit_price, oninput: (e) => { it.unit_price = e.target.value; recalc(); } });
    const unitInp = h("input", { type: "text", value: it.unit || "", placeholder: "หน่วย", onchange: (e) => { it.unit = e.target.value.trim() || "หน่วย"; } });
    const nameInp = h("input", { type: "text", value: it.product_name || "", placeholder: "ชื่อสินค้า/บริการ *", oninput: (e) => { it.product_name = e.target.value; recalc(); } });
    const codeInp = h("input", { type: "text", value: it.product_code || "", placeholder: "ไม่บังคับ", onchange: (e) => { it.product_code = e.target.value.trim(); } });
    const descInp = h("input", { type: "text", value: it.description || "", placeholder: "รายละเอียด", oninput: (e) => { it.description = e.target.value; } });
    const discType = h("select", { class: "control sm", onchange: (e) => { it.discount_type = e.target.value; if (!e.target.value) it.discount_value = ""; recalc(); } },
      h("option", { value: "" }, "ไม่ส่วนลด"),
      h("option", { value: "percent" }, "%"),
      h("option", { value: "amount" }, "บาท"));
    discType.value = it.discount_type || "";
    const discInp = h("input", {
      type: "number", min: "0", step: "any", value: it.discount_value ?? "", placeholder: "0",
      disabled: !it.discount_type,
      oninput: (e) => { it.discount_value = e.target.value; recalc(); },
      onchange: (e) => { discInp.disabled = !it.discount_type; }
    });
    discType.addEventListener("change", () => { discInp.disabled = !it.discount_type; });
    const taxInp = h("input", { type: "number", min: "0", max: "100", step: "any", value: it.tax_rate ?? 7, oninput: (e) => { it.tax_rate = e.target.value; } });
    const lineCell = h("td", { class: "num line-total-td" }, "0.00");
    const delBtn = h("button", { class: "icon-btn danger", title: "ลบรายการ", onclick: () => { doc.items.splice(idx, 1); renderItems(); recalc(); } }, "🗑");

    return h("tr", {},
      h("td", {}, h("div", { class: "stack-sm" }, codeInp, nameInp, descInp)),
      h("td", {}, h("div", { class: "cell-pair" }, qtyInp, unitInp)),
      h("td", {}, priceInp),
      h("td", {}, h("div", { class: "cell-pair" }, discType, discInp)),
      h("td", {}, taxInp),
      lineCell,
      h("td", {}, delBtn)
    );
  }

  function renderItems() {
    fill(itemsBody,
      doc.items.length
        ? doc.items.map((it, i) => itemRowEl(it, i))
        : [h("tr", {}, h("td", { colSpan: "7", class: "muted", style: { textAlign: "center", padding: "18px" } }, "ยังไม่มีรายการสินค้า — กดปุ่มด้านล่างเพื่อเพิ่ม"))]
    );
    recalc();
  }

  function addItem(prefill) {
    doc.items.push({
      product_id: prefill ? prefill.id : null,
      product_code: prefill ? (prefill.code || "") : "",
      product_name: prefill ? prefill.name : "",
      description: prefill ? (prefill.description || "") : "",
      quantity: 1,
      unit: prefill ? (prefill.unit || "หน่วย") : "หน่วย",
      unit_price: prefill ? prefill.unit_price : 0,
      discount_type: "", discount_value: "",
      tax_rate: prefill ? (prefill.tax_rate ?? 7) : (doc.tax_rate ?? 7)
    });
    renderItems();
  }

  const addRowBtn = h("button", { class: "btn", onclick: () => addItem(null) }, "+ เพิ่มรายการ (บริการที่ไม่มีรหัสสินค้าได้)");
  const pickProdBtn = h("button", { class: "btn", onclick: () => openProductPicker(products, (p) => addItem(p)) }, "📦 เลือกจากคลังสินค้า");

  const itemsCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "รายการสินค้าและบริการ",
      h("span", { class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } },
        "ราคาถูกบันทึกเป็น snapshot ณ เวลาสร้างเอกสาร")),
    h("div", { class: "table-wrap" }, h("table", { class: "data quo-items" },
      h("thead", {}, h("tr", {},
        ["สินค้า / บริการ", "จำนวน / หน่วย", "ราคาต่อหน่วย", "ส่วนลด", "ภาษี %", "ยอดรวม", ""]
          .map((t, i) => h("th", { class: i >= 4 && i <= 5 ? "num" : "" }, t)))),
      itemsBody)),
    h("div", { class: "card-body row", style: { borderTop: "1px solid var(--border)" } }, pickProdBtn, addRowBtn)
  );

  /* ---------- ส่วน 4.4 การคำนวณ ---------- */
  const taxModeSel = h("select", { class: "control", onchange: (e) => { doc.tax_mode = e.target.value; taxRateInp.disabled = doc.tax_mode === "none"; recalc(); } },
    Object.entries(Quo.TAX_MODES).map(([k, v]) => h("option", { value: k }, v)));
  taxModeSel.value = doc.tax_mode;
  const taxRateInp = h("input", { type: "number", min: "0", max: "100", step: "any", value: doc.tax_rate, oninput: (e) => { doc.tax_rate = e.target.value; recalc(); } });
  taxRateInp.disabled = doc.tax_mode === "none";

  const discTypeSel = h("select", { class: "control", onchange: (e) => {
    doc.discount_type = e.target.value;
    docDiscInp.disabled = !doc.discount_type;
    if (!doc.discount_type) doc.discount_value = "";
    recalc();
  } },
    h("option", { value: "" }, "ไม่ลดท้ายเอกสาร"),
    h("option", { value: "percent" }, "เปอร์เซ็นต์ (%)"),
    h("option", { value: "amount" }, "จำนวนเงิน (บาท)"));
  discTypeSel.value = doc.discount_type || "";
  const docDiscInp = h("input", { type: "number", min: "0", step: "any", value: doc.discount_value ?? "", placeholder: "0", disabled: !doc.discount_type, oninput: (e) => { doc.discount_value = e.target.value; recalc(); } });

  const summaryBox = h("div", { class: "quo-summary" });

  const payTerms = h("textarea", { rows: "2", placeholder: "เช่น ชำระเงินล่วงหน้า 50% ภายใน 7 วัน", onchange: (e) => { doc.payment_terms = e.target.value; } });
  payTerms.value = doc.payment_terms || "";
  const notesTa = h("textarea", { rows: "2", placeholder: "หมายเหตุที่แสดงบนเอกสาร", onchange: (e) => { doc.notes = e.target.value; } });
  notesTa.value = doc.notes || "";

  const totalsCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "สรุปการคำนวณราคา"),
    h("div", { class: "card-body" },
      h("div", { class: "form-grid", style: { marginBottom: "12px" } },
        h("div", { class: "form-field" }, h("label", {}, "รูปแบบ VAT"), taxModeSel),
        h("div", { class: "form-field" }, h("label", {}, "อัตรา VAT (%)"), taxRateInp),
        h("div", { class: "form-field" }, h("label", {}, "ส่วนลดท้ายเอกสาร"), h("div", { class: "row" }, discTypeSel, docDiscInp)),
        h("div", { class: "form-field" }, h("label", {}, "สกุลเงิน"), h("input", { type: "text", value: "THB (บาท)", disabled: true }))
      ),
      summaryBox,
      h("div", { class: "form-grid", style: { marginTop: "12px" } },
        h("div", { class: "form-field full" }, h("label", {}, "เงื่อนไขการชำระเงิน"), payTerms),
        h("div", { class: "form-field full" }, h("label", {}, "หมายเหตุ"), notesTa)
      ))
  );

  /* ---------- คำนวณใหม่ทุกครั้งที่มีการแก้ไข ---------- */
  function collectPayload() {
    return {
      customer_id: doc.customer_id || null,
      customer_name: doc.customer_name,
      customer_address: doc.customer_address,
      customer_tax_id: doc.customer_tax_id,
      contact_name: doc.contact_name, contact_email: doc.contact_email, contact_phone: doc.contact_phone,
      issue_date: doc.issue_date, expiry_date: doc.expiry_date,
      tax_mode: doc.tax_mode, tax_rate: doc.tax_rate,
      discount_type: doc.discount_type || null,
      discount_value: doc.discount_type ? (doc.discount_value === "" ? 0 : Number(doc.discount_value)) : null,
      payment_terms: doc.payment_terms, notes: doc.notes,
      owner: doc.owner, prepared_by: doc.prepared_by,
      items: doc.items.map((it) => ({
        product_id: it.product_id || null,
        product_code: it.product_code || "",
        product_name: it.product_name,
        description: it.description || "",
        quantity: it.quantity === "" ? 1 : Number(it.quantity),
        unit: it.unit || "หน่วย",
        unit_price: it.unit_price === "" ? 0 : Number(it.unit_price),
        discount_type: it.discount_type || null,
        discount_value: it.discount_type && it.discount_value !== "" ? Number(it.discount_value) : null,
        tax_rate: it.tax_rate === "" || it.tax_rate === undefined ? 7 : Number(it.tax_rate)
      }))
    };
  }

  function recalc() {
    const payload = collectPayload();
    const t = Quo.calcTotals(payload);
    /* อัปเดตยอดรวมรายแถว */
    const rows = itemsBody ? itemsBody.children : [];
    doc.items.forEach((it, i) => {
      const c = Quo.calcLine(it);
      const tr = rows[i];
      if (tr) {
        const cell = tr.querySelector(".line-total-td");
        if (cell) cell.textContent = money2(c.line_total);
      }
    });
    fill(summaryBox,
      quoSummaryRow("ยอดรวมก่อนส่วนลด", money2(t.subtotal)),
      quoSummaryRow("ส่วนลดรายสินค้า", "− " + money2(t.line_discount_total)),
      quoSummaryRow("ส่วนลดท้ายเอกสาร", "− " + money2(t.discount_amount)),
      quoSummaryRow("ยอดรวมหลังหักส่วนลด", money2(t.taxable_amount), true),
      quoSummaryRow(t.tax_mode === "none" ? "ภาษีมูลค่าเพิ่ม (ไม่คิด VAT)" : `ภาษีมูลค่าเพิ่ม ${t.tax_rate}%` +
        (t.tax_mode === "inclusive" ? " (รวมในราคาแล้ว แสดงแยก)" : ""), money2(t.tax_amount)),
      quoSummaryRow("ยอดสุทธิที่ต้องชำระ", money2(t.grand_total) + " บาท", true, "grand"),
      h("div", { class: "quo-bahttext" }, "♡ " + Quo.bahtText(t.grand_total))
    );
  }

  function quoSummaryRow(label, value, strong, cls) {
    return h("div", { class: "quo-sum-row" + (strong ? " strong" : "") + (cls ? " " + cls : "") },
      h("span", {}, label), h("b", {}, value));
  }

  /* ---------- บันทึก ---------- */
  async function save() {
    const payload = collectPayload();
    const clientErr = Quo.validateDocument(payload);
    if (clientErr) { toast(clientErr, "error"); return; }
    try {
      showLoading();
      const res = editing
        ? await QuoApi.update(id, payload)
        : await QuoApi.create(payload);
      hideLoading();
      toast(editing ? "บันทึกการแก้ไขแล้ว" : "สร้างใบเสนอราคา " + res.quotation.quotation_number + " แล้ว", "success");
      go("#/quotation/" + res.quotation.id);
    } catch (e) {
      hideLoading();
      toast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
  }

  renderItems();

  root.append(
    topbar({
      left: [h("button", { class: "btn ghost", onclick: () => history.length > 1 ? history.back() : go("#/quotations") }, "← กลับ")],
      title: editing ? "แก้ไขใบเสนอราคา " + quotation.quotation_number : "สร้างใบเสนอราคาใหม่",
      sub: editing ? "สถานะ: " + Quo.STATUS_LABELS[quotation.status] : "ใบเสนอราคาฉบับร่าง · เลขที่จะถูกสร้างอัตโนมัติ",
      right: [
        h("div", { class: "row" },
          h("button", { class: "btn", onclick: () => history.length > 1 ? history.back() : go("#/quotations") }, "ยกเลิก"),
          h("button", { class: "btn primary", onclick: save }, editing ? "บันทึกการแก้ไข" : "💾 บันทึกใบเสนอราคา"))
      ]
    }),
    h("div", { class: "page" },
      h("div", { class: "quo-form-wrap" },
        docCard, custCard, itemsCard, totalsCard))
  );
  recalc();
}

/* ---------- เลือกลูกค้าจาก CRM (records เดิม) ---------- */
function openCustomerPicker(onPick) {
  const listBox = h("div", { class: "picker-list" });
  const search = h("input", { type: "search", placeholder: "ค้นหาชื่อบริษัท, ผู้ติดต่อ, อีเมล, เบอร์โทร…" });

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const rows = state.records.filter((rec) => {
      if (!q) return true;
      return Object.values(rec.values).some((v) => String(Array.isArray(v) ? v.join(" ") : (v ?? "")).toLowerCase().includes(q));
    }).slice(0, 60);
    fill(listBox,
      rows.length
        ? rows.map((rec) => h("div", { class: "picker-item", onclick: () => { closeModal(); onPick(rec); } },
            h("div", { class: "avatar" }, initials(rec.values.contact_name || rec.values.company)),
            h("div", { class: "li-main" },
              h("div", { class: "li-title" }, rec.values.company || "(ไม่มีชื่อ)"),
              h("div", { class: "li-sub" },
                [rec.values.contact_name, rec.values.phone, rec.values.email, rec.values.address].filter(Boolean).join(" · ") || "—")),
            h("span", { class: "pill s-other" }, rec.values.customer_code || "")
          ))
        : h("p", { class: "muted" }, "ไม่พบลูกค้าที่ค้นหา")
    );
  }
  search.addEventListener("input", debounce(renderList, 150));
  renderList();

  openModal({
    title: "เลือกลูกค้าจากระบบ CRM",
    wide: true,
    body: h("div", {},
      h("div", { class: "search-box", style: { marginBottom: "10px" } }, search),
      h("p", { class: "muted small" }, "เลือกลูกค้าจากระเบียนที่มีอยู่แล้ว — ระบบจะดึงข้อมูลมาเติมให้อัตโนมัติ ไม่สร้างข้อมูลซ้ำ"),
      listBox),
    footer: [h("button", { class: "btn", onclick: closeModal }, "ยกเลิก")]
  });
}

/* ---------- เลือกสินค้าจากคลัง ---------- */
function openProductPicker(products, onPick) {
  const listBox = h("div", { class: "picker-list" });
  const search = h("input", { type: "search", placeholder: "ค้นหาด้วยชื่อหรือรหัสสินค้า…" });

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const rows = products.filter((p) => !q || (p.name || "").toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q));
    fill(listBox,
      rows.length
        ? rows.map((p) => h("div", { class: "picker-item", onclick: () => { onPick(p); } },
            h("div", { class: "li-main" },
              h("div", { class: "li-title" }, p.name, p.code ? h("span", { class: "muted small mono" }, "  " + p.code) : null),
              h("div", { class: "li-sub" }, (p.description ? p.description + " · " : "") + "หน่วย: " + p.unit)),
            h("b", {}, moneyB(p.unit_price))
          ))
        : h("p", { class: "muted" }, "ไม่พบสินค้าที่ค้นหา — ใช้ปุ่ม “เพิ่มรายการ” เพื่อพิมพ์เองได้")
    );
  }
  search.addEventListener("input", debounce(renderList, 150));
  renderList();

  openModal({
    title: "เลือกสินค้า/บริการจากคลัง",
    wide: true,
    body: h("div", {},
      h("div", { class: "search-box", style: { marginBottom: "10px" } }, search),
      h("p", { class: "muted small" }, "คลิกเพื่อเพิ่มลงในใบเสนอราคา (เพิ่มได้หลายรายการ)"),
      listBox),
    footer: [h("button", { class: "btn", onclick: closeModal }, "เสร็จสิ้น")]
  });
}

/* ============================================================
   4) รายละเอียดใบเสนอราคา
   ============================================================ */
function viewQuotationDetail(id) {
  const root = h("div", {});
  root.append(h("div", { class: "page" }, h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลด…"))));

  (async () => {
    try {
      showLoading();
      const data = await QuoApi.get(id);
      hideLoading();
      buildQuotationDetail(root, data);
    } catch (e) {
      hideLoading();
      fill(root, quoErrCard(e),
        h("div", { style: { textAlign: "center", marginTop: "12px" } },
          h("button", { class: "btn primary", onclick: () => go("#/quotations/list") }, "กลับไปที่รายการ")));
    }
  })();

  return root;
}

function buildQuotationDetail(root, { quotation: q, items, logs }) {
  fill(root);
  const p = perms();

  /* ---- ปุ่มดำเนินการ ---- */
  const actions = [];
  actions.push(h("button", { class: "btn", onclick: () => go("#/quotation/" + q.id + "/print") }, "🖨 ดูตัวอย่าง / PDF"));
  if (quoCanEdit(q) && quoEditable(q)) {
    actions.push(h("button", { class: "btn", onclick: () => go("#/quotation/" + q.id + "/edit") }, "✎ แก้ไข"));
  }
  if (p.canWrite) {
    actions.push(h("button", { class: "btn", onclick: async () => {
      const ok2 = await confirmDialog(`ทำสำเนา ${q.quotation_number} เป็นเอกสารฉบับใหม่ (Draft)?`, { okText: "ทำสำเนา" });
      if (!ok2) return;
      try {
        showLoading();
        const created = await QuoApi.duplicate(q.id);
        hideLoading();
        toast("ทำสำเนาเป็น " + created.quotation.quotation_number, "success");
        go("#/quotation/" + created.quotation.id);
      } catch (e) { hideLoading(); toast(e.message, "error"); }
    } }, "⧉ ทำสำเนา"));
  }
  if (quoCanDelete(q)) {
    actions.push(h("button", { class: "btn danger", onclick: async () => {
      const ok2 = await confirmDialog(`ลบใบเสนอราคา ${q.quotation_number}? ไม่สามารถย้อนกลับได้`, { danger: true, okText: "ลบ" });
      if (!ok2) return;
      try { await QuoApi.remove(q.id); toast("ลบเอกสารแล้ว", "success"); go("#/quotations/list"); }
      catch (e) { toast(e.message, "error"); }
    } }, "🗑 ลบ"));
  }

  /* ---- เปลี่ยนสถานะ (ตามกฎ STATUS_TRANSITIONS) ---- */
  const allowed = Quo.STATUS_TRANSITIONS[q.status] || [];
  let statusCtl = null;
  if (allowed.length && p.canWrite) {
    const needsApprove = (to) => [Quo.STATUS.APPROVED, Quo.STATUS.REJECTED].includes(to) || to === Quo.STATUS.CANCELLED;
    statusCtl = h("select", { class: "control", onchange: async (e) => {
      const to = e.target.value;
      e.target.value = "";
      if (!to || to === q.status) return;
      const label = Quo.STATUS_LABELS[to];
      const ok2 = await confirmDialog(
        to === Quo.STATUS.APPROVED ? `ยืนยันอนุมัติใบเสนอราคา ${q.quotation_number} (มูลค่า ${moneyB(q.grand_total)})?`
        : needsApprove(to) ? `เปลี่ยนสถานะเป็น "${label}"?`
        : `เปลี่ยนสถานะเป็น "${label}"?`, { okText: "ยืนยัน", danger: to === Quo.STATUS.REJECTED || to === Quo.STATUS.CANCELLED });
      if (!ok2) return;
      try {
        await QuoApi.setStatus(q.id, to);
        toast("เปลี่ยนสถานะเป็น " + label + " แล้ว", "success");
        const fresh = await QuoApi.get(q.id);
        buildQuotationDetail(root, fresh);
      } catch (e) { toast(e.message, "error"); }
    } },
      h("option", { value: "" }, "เปลี่ยนสถานะ…"),
      allowed.map((s) => h("option", { value: s }, Quo.STATUS_LABELS[s])));
  }

  /* ---- การ์ดข้อมูล ---- */
  const infoCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ข้อมูลเอกสาร"),
    h("div", { class: "card-body" },
      h("div", { class: "fields-grid" },
        summaryLine("เลขที่ใบเสนอราคา", h("b", { class: "mono" }, q.quotation_number)),
        summaryLine("สถานะ", quoStatusPill(q.status)),
        summaryLine("วันที่ออกเอกสาร", fmtDate(q.issue_date)),
        summaryLine("วันหมดอายุ", q.expiry_date ? fmtDate(q.expiry_date) : "—"),
        summaryLine("ผู้จัดทำ", q.created_by_name || "—"),
        summaryLine("ผู้รับผิดชอบ", q.owner || "—"),
        summaryLine("ผู้อนุมัติ", q.approved_by_name ? q.approved_by_name + (q.approved_at ? " · " + fmtDateTime(q.approved_at) : "") : "—"),
        summaryLine("สกุลเงิน", q.currency),
        summaryLine("สร้างเมื่อ", fmtDateTime(q.created_at)),
        summaryLine("แก้ไขล่าสุด", fmtDateTime(q.updated_at))
      ))
  );

  const custCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ข้อมูลลูกค้า",
      q.customer_id ? h("a", { href: "#/record/" + q.customer_id, class: "muted small", style: { marginLeft: "auto", fontWeight: "400" } }, "เปิดหน้าลูกค้า →") : null),
    h("div", { class: "card-body" },
      h("div", { class: "fields-grid" },
        summaryLine("ชื่อลูกค้า", h("b", {}, q.customer_name)),
        summaryLine("ที่อยู่", q.customer_address || "—"),
        summaryLine("เลขประจำตัวผู้เสียภาษี", q.customer_tax_id || "—"),
        summaryLine("ผู้ติดต่อ", q.contact_name || "—"),
        summaryLine("อีเมล", q.contact_email ? h("a", { href: "mailto:" + q.contact_email }, q.contact_email) : "—"),
        summaryLine("เบอร์โทรศัพท์", q.contact_phone || "—")
      ))
  );

  /* ---- ตารางรายการ ---- */
  const itemsCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "รายการสินค้าและบริการ (" + items.length + " รายการ)"),
    h("div", { class: "table-wrap" }, h("table", { class: "data" },
      h("thead", {}, h("tr", {},
        ["รหัสสินค้า", "ชื่อสินค้า / รายละเอียด", "จำนวน", "หน่วย", "ราคาต่อหน่วย", "ส่วนลด", "ยอดรวม"]
          .map((t, i) => h("th", { class: i >= 4 ? "num" : "" }, t)))),
      h("tbody", {}, items.map((it) => h("tr", {},
        h("td", { class: "mono small" }, it.product_code || "—"),
        h("td", {}, h("div", {}, h("b", {}, it.product_name), it.description ? h("div", { class: "muted small" }, it.description) : null)),
        h("td", { class: "num" }, fmtNumber(it.quantity)),
        h("td", {}, it.unit),
        h("td", { class: "num" }, money2(it.unit_price)),
        h("td", { class: "num" }, it.discount_type
          ? (it.discount_type === "percent" ? fmtNumber(it.discount_value) + "%" : money2(it.discount_value))
          : "—"),
        h("td", { class: "num" }, money2(it.line_total))
      )))))
  );

  /* ---- สรุปยอด (คำนวณจากคอลัมน์ที่บันทึกไว้ในเอกสาร) ---- */
  const lineGross = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const lineDiscountTotal = Quo.round2(Math.max(0, lineGross - q.subtotal));
  const sumCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "สรุปการคำนวณ"),
    h("div", { class: "card-body" },
      h("div", { class: "quo-summary" },
        h("div", { class: "quo-sum-row" }, h("span", {}, "ยอดรวมก่อนส่วนลด"), h("b", {}, money2(q.subtotal))),
        h("div", { class: "quo-sum-row" }, h("span", {}, "ส่วนลดรายสินค้า"), h("b", {}, "− " + money2(lineDiscountTotal))),
        h("div", { class: "quo-sum-row" }, h("span", {}, "ส่วนลดท้ายเอกสาร"), h("b", {}, "− " + money2(q.discount_amount))),
        h("div", { class: "quo-sum-row strong" }, h("span", {}, "ยอดรวมหลังหักส่วนลด"), h("b", {}, money2(q.taxable_amount))),
        h("div", { class: "quo-sum-row" }, h("span", {},
          q.tax_mode === "none" ? "ภาษีมูลค่าเพิ่ม (ไม่คิด VAT)" : `ภาษีมูลค่าเพิ่ม ${q.tax_rate}%`),
          h("b", {}, money2(q.tax_amount))),
        h("div", { class: "quo-sum-row grand" }, h("span", {}, "ยอดสุทธิที่ต้องชำระ"), h("b", {}, money2(q.grand_total) + " บาท")),
        h("div", { class: "quo-bahttext" }, "♡ " + q.baht_text),
        q.payment_terms ? h("div", { class: "small muted" }, "เงื่อนไขการชำระเงิน: " + q.payment_terms) : null,
        q.notes ? h("div", { class: "small muted" }, "หมายเหตุ: " + q.notes) : null
      ))
  );

  /* ---- ประวัติการเปลี่ยนสถานะ ---- */
  const ACTION_TH = { create: "สร้างเอกสาร", update: "แก้ไขเอกสาร", status: "เปลี่ยนสถานะ", duplicate: "ทำสำเนา", delete: "ลบเอกสาร" };
  const timeline = h("div", { class: "timeline" },
    logs.length
      ? logs.map((lg) => h("div", { class: "tl-item system" },
          h("div", { class: "avatar" }, "•"),
          h("div", { class: "tl-body" },
            h("div", { class: "tl-head" },
              h("span", {}, h("strong", {}, lg.user_name || "ระบบ"), " ", lg.detail || ACTION_TH[lg.action] || lg.action),
              h("span", {}, fmtDateTime(lg.created_at))))))
      : h("p", { class: "muted mb0" }, "ยังไม่มีประวัติ")
  );

  const logsCard = h("div", { class: "card" },
    h("div", { class: "card-head" }, "ประวัติการดำเนินการ"),
    h("div", { class: "card-body" }, timeline)
  );

  root.append(
    topbar({
      left: [h("button", { class: "btn ghost", onclick: () => history.length > 1 ? history.back() : go("#/quotations/list") }, "← กลับ")],
      title: q.quotation_number,
      sub: q.customer_name + " · " + moneyB(q.grand_total) + " · แก้ไขล่าสุด " + relTime(q.updated_at),
      right: [h("div", { class: "row", style: { flexWrap: "wrap" } }, statusCtl, ...actions)]
    }),
    h("div", { class: "page" },
      h("div", { class: "dash-grid" },
        h("div", {}, infoCard, h("div", { class: "mt16" }, custCard), h("div", { class: "mt16" }, itemsCard)),
        h("div", {}, sumCard, h("div", { class: "mt16" }, logsCard))
      ))
  );
}

/* ============================================================
   5) ตัวอย่างเอกสาร A4 + พิมพ์/ดาวน์โหลด PDF (window.print)
   ============================================================ */
function viewQuotationPrint(id) {
  const root = h("div", {});
  root.append(h("div", { class: "page" }, h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลดเอกสาร…"))));

  (async () => {
    try {
      const [data, settings] = await Promise.all([QuoApi.get(id), QuoApi.getSettings()]);
      fill(root);
      root.append(
        /* แถบเครื่องมือ (ไม่แสดงตอนพิมพ์) */
        h("div", { class: "topbar print-toolbar" },
          h("button", { class: "btn ghost", onclick: () => go("#/quotation/" + id) }, "← กลับ"),
          h("div", {}, h("h1", {}, "ตัวอย่างเอกสาร " + data.quotation.quotation_number),
            h("p", { class: "sub" }, "กดพิมพ์ แล้วเลือก “บันทึกเป็น PDF” เพื่อดาวน์โหลด · กระดาษ A4 · ภาษาไทย")),
          h("div", { class: "topbar-spacer" }),
          h("div", { class: "row" },
            perms().canWrite && quoEditable(data.quotation)
              ? h("button", { class: "btn", onclick: () => go("#/quotation/" + id + "/edit") }, "✎ แก้ไข") : null,
            h("button", { class: "btn primary", onclick: () => window.print() }, "🖨 พิมพ์ / บันทึก PDF"))
        ),
        h("div", { class: "print-area" }, buildQuotationDoc(data, settings))
      );
    } catch (e) {
      fill(root, quoErrCard(e));
    }
  })();

  return root;
}

/** สร้าง DOM เอกสาร A4 (ใช้ทั้งตอน preview และตอน window.print) */
function buildQuotationDoc({ quotation: q, items }, s) {
  const logo = s.logo_url
    ? h("img", { class: "qt-logo", src: s.logo_url, alt: "โลโก้" })
    : h("div", { class: "qt-logo qt-logo-fallback" }, (s.logo_text || s.company_name || "C").slice(0, 2));

  const totals = {
    discount_amount: q.discount_amount, taxable_amount: q.taxable_amount,
    tax_amount: q.tax_amount, grand_total: q.grand_total, tax_rate: q.tax_rate, tax_mode: q.tax_mode
  };

  return h("div", { class: "qt-doc" },
    /* หัวเอกสาร */
    h("div", { class: "qt-head" },
      h("div", { class: "qt-company" },
        logo,
        h("div", {},
          h("div", { class: "qt-cname" }, s.company_name || "บริษัท / ร้านค้าของคุณ"),
          h("div", { class: "qt-caddr" }, s.company_address || ""),
          s.company_tax_id ? h("div", {}, "เลขประจำตัวผู้เสียภาษี: " + s.company_tax_id) : null,
          h("div", {}, [s.company_phone && "โทร: " + s.company_phone, s.company_email].filter(Boolean).join(" · "))
        )),
      h("div", { class: "qt-title" },
        h("div", {}, "ใบเสนอราคา"),
        h("div", { class: "qt-title-en" }, "QUOTATION"),
        h("div", { class: "qt-number mono" }, q.quotation_number))
    ),

    /* วันที่ + ลูกค้า */
    h("div", { class: "qt-meta" },
      h("div", { class: "qt-cust" },
        h("div", { class: "qt-label" }, "เรียน (ลูกค้า)"),
        h("div", { class: "qt-cust-name" }, q.customer_name),
        q.customer_address ? h("div", {}, q.customer_address) : null,
        q.customer_tax_id ? h("div", {}, "เลขประจำตัวผู้เสียภาษี: " + q.customer_tax_id) : null,
        q.contact_name ? h("div", {}, "ผู้ติดต่อ: " + q.contact_name) : null,
        q.contact_phone ? h("div", {}, "โทร: " + q.contact_phone) : null,
        q.contact_email ? h("div", {}, q.contact_email) : null),
      h("div", { class: "qt-dates" },
        qtDateRow("วันที่ออกเอกสาร", fmtDate(q.issue_date)),
        qtDateRow("วันหมดอายุ", q.expiry_date ? fmtDate(q.expiry_date) : "—"),
        qtDateRow("ผู้จัดทำ", q.prepared_by || q.created_by_name || "—"),
        qtDateRow("ผู้รับผิดชอบ", q.owner || "—"))),

    /* ตารางสินค้า */
    h("table", { class: "qt-items" },
      h("thead", {}, h("tr", {},
        h("th", { class: "qt-c-no" }, "ลำดับ"),
        h("th", {}, "รายการสินค้า / บริการ"),
        h("th", { class: "qt-c-qty" }, "จำนวน"),
        h("th", { class: "qt-c-unit" }, "หน่วย"),
        h("th", { class: "qt-c-price" }, "ราคาต่อหน่วย"),
        h("th", { class: "qt-c-disc" }, "ส่วนลด"),
        h("th", { class: "qt-c-total" }, "ยอดรวม"))),
      h("tbody", {}, items.map((it, i) => {
        const c = Quo.calcLine(it);
        return h("tr", {},
          h("td", { class: "qt-c-no" }, i + 1),
          h("td", {}, h("div", { class: "qt-item-name" }, it.product_name),
            it.product_code ? h("div", { class: "qt-item-code" }, "รหัส: " + it.product_code) : null,
            it.description ? h("div", { class: "qt-item-desc" }, it.description) : null),
          h("td", { class: "qt-c-qty num" }, fmtNumber(it.quantity)),
          h("td", { class: "qt-c-unit" }, it.unit),
          h("td", { class: "qt-c-price num" }, money2(it.unit_price)),
          h("td", { class: "qt-c-disc num" }, it.discount_type
            ? (it.discount_type === "percent" ? fmtNumber(it.discount_value) + "%" : money2(it.discount_value))
            : "—"),
          h("td", { class: "qt-c-total num" }, money2(c.line_total)));
      }))),

    /* สรุปยอด + คำอ่านไทย */
    h("div", { class: "qt-foot-grid" },
      h("div", { class: "qt-terms" },
        q.payment_terms ? h("div", {}, h("b", {}, "เงื่อนไขการชำระเงิน: "), q.payment_terms) : null,
        q.notes ? h("div", {}, h("b", {}, "หมายเหตุ: "), q.notes) : null,
        h("div", { class: "qt-baht" }, "จำนวนเงิน " + q.baht_text)),
      h("div", { class: "qt-totals" },
        qtTotalRow("ยอดรวมก่อนส่วนลด", money2(q.subtotal)),
        qtTotalRow("ส่วนลดท้ายเอกสาร", "− " + money2(q.discount_amount)),
        qtTotalRow("ยอดรวมหลังหักส่วนลด", money2(q.taxable_amount)),
        qtTotalRow(q.tax_mode === "none" ? "VAT (ไม่คิดภาษี)" : `VAT ${q.tax_rate}%`, money2(q.tax_amount)),
        qtTotalRow("ยอดสุทธิ", money2(q.grand_total) + " บาท", true))),

    /* ช่องลงชื่อ */
    h("div", { class: "qt-sign" },
      h("div", { class: "qt-sign-col" },
        h("div", {}, "ผู้เสนอราคา"),
        h("div", { class: "qt-sign-line" }, q.prepared_by || q.created_by_name || "")),
      h("div", { class: "qt-sign-col" },
        h("div", {}, "ผู้อนุมัติ"),
        h("div", { class: "qt-sign-line" }, q.approved_by_name || "")),
      h("div", { class: "qt-sign-col" },
        h("div", {}, "ผู้รับใบเสนอราคา"),
        h("div", { class: "qt-sign-line" }, ""))),

    h("div", { class: "qt-note-print" }, "เอกสารนี้ออกผ่านระบบ CRM — " + (s.company_name || "") + (q.quotation_number ? " · " + q.quotation_number : ""))
  );
}

function qtDateRow(label, value) {
  return h("div", { class: "qt-date-row" }, h("span", {}, label), h("b", {}, value));
}
function qtTotalRow(label, value, strong) {
  return h("div", { class: "qt-total-row" + (strong ? " strong" : "") }, h("span", {}, label), h("b", {}, value));
}

/* ============================================================
   6) ตั้งค่าเอกสารใบเสนอราคา (admin)
   ============================================================ */
function viewQuotationSettings() {
  const root = h("div", {});
  const isAdminUser = perms().isAdmin;
  root.append(h("div", { class: "page" }, h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลด…"))));

  (async () => {
    try {
      const s = await QuoApi.getSettings();
      fill(root);

      const F = {};
      const field = (key, label, type, hint) => {
        let el;
        if (type === "textarea") el = h("textarea", { rows: "3" });
        else if (type === "select-taxmode") {
          el = h("select", {}, Object.entries(Quo.TAX_MODES).map(([k, v]) => h("option", { value: k }, v)));
          el.value = s[key] || "exclusive";
        } else el = h("input", { type: type || "text" });
        el.value = s[key] ?? "";
        if (!isAdminUser) el.disabled = true;
        F[key] = el;
        return h("div", { class: "form-field" + (type === "textarea" ? " full" : "") },
          h("label", {}, label), el,
          hint ? h("div", { class: "hint" }, hint) : null);
      };

      const form = h("div", { class: "form-grid" },
        field("company_name", "ชื่อบริษัท / ร้านค้า"),
        field("company_tax_id", "เลขประจำตัวผู้เสียภาษีผู้ขาย"),
        field("company_phone", "เบอร์โทรศัพท์"),
        field("company_email", "อีเมล"),
        field("company_address", "ที่อยู่บริษัท", "textarea"),
        field("logo_url", "โลโก้ (URL รูปภาพ https://…)", "text", "เว้นว่างเพื่อใช้ตัวอักษรย่อเป็นโลโก้"),
        field("logo_text", "ข้อความโลโก้ (ใช้เมื่อไม่ได้ตั้ง URL)"),
        field("default_payment_terms", "เงื่อนไขการชำระเงินเริ่มต้น", "textarea"),
        field("default_notes", "หมายเหตุเริ่มต้น", "textarea"),
        field("default_tax_mode", "รูปแบบ VAT เริ่มต้น", "select-taxmode"),
        field("default_tax_rate", "อัตรา VAT เริ่มต้น (%)", "number"),
        field("default_validity_days", "อายุเอกสารเริ่มต้น (วัน)", "number", "ใช้คำนวณวันหมดอายุตอนสร้างเอกสารใหม่")
      );

      const saveBtn = h("button", {
        class: "btn primary", disabled: !isAdminUser,
        onclick: async () => {
          try {
            showLoading();
            await QuoApi.saveSettings({
              company_name: F.company_name.value, company_tax_id: F.company_tax_id.value,
              company_phone: F.company_phone.value, company_email: F.company_email.value,
              company_address: F.company_address.value,
              logo_url: F.logo_url.value.trim(), logo_text: F.logo_text.value,
              default_payment_terms: F.default_payment_terms.value,
              default_notes: F.default_notes.value,
              default_tax_mode: F.default_tax_mode.value,
              default_tax_rate: Number(F.default_tax_rate.value),
              default_validity_days: Number(F.default_validity_days.value)
            });
            hideLoading();
            toast("บันทึกตั้งค่าเอกสารแล้ว", "success");
          } catch (e) { hideLoading(); toast("บันทึกไม่สำเร็จ: " + e.message, "error"); }
        }
      }, "💾 บันทึกการตั้งค่า");

      root.append(
        topbar({
          title: "ตั้งค่าเอกสารใบเสนอราคา",
          sub: "ข้อมูลบริษัทและค่าเริ่มต้นที่ใช้บนเอกสาร PDF",
          right: [saveBtn]
        }),
        h("div", { class: "page" },
          !isAdminUser ? h("div", { class: "card empty" }, h("p", {}, "เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขการตั้งค่าเอกสารได้")) : null,
          h("div", { class: "card" },
            h("div", { class: "card-head" }, "ข้อมูลเอกสารและบริษัท"),
            h("div", { class: "card-body" }, form),
            h("div", { class: "card-body", style: { borderTop: "1px solid var(--border)" } },
              h("div", { class: "row" }, saveBtn)))
        )
      );
    } catch (e) { fill(root, quoErrCard(e)); }
  })();

  return root;
}

/* ============================================================
   7) คลังสินค้า/บริการ (Products)
   ============================================================ */
function viewProducts() {
  const root = h("div", {});
  const body = h("div", { id: "prod-body" }, h("div", { class: "card empty" }, h("p", { class: "muted" }, "กำลังโหลด…")));
  const search = h("input", { type: "search", placeholder: "ค้นหาด้วยชื่อหรือรหัสสินค้า…", oninput: debounce((e) => loadProducts(body, e.target.value), 200) });

  loadProducts(body, "");

  const addBtn = perms().canWrite
    ? h("button", { class: "btn primary", onclick: () => openProductModal(null, () => loadProducts(body, search.value)) }, "+ เพิ่มสินค้า/บริการ")
    : null;

  root.append(
    topbar({
      title: "สินค้าและบริการ",
      sub: "คลังสินค้าสำหรับเลือกในใบเสนอราคา (ราคา ณ เวลาสร้างเอกสารถูกเก็บเป็น snapshot)",
      right: [h("div", { class: "search-box" }, search), addBtn]
    }),
    h("div", { class: "page" }, body)
  );
  root._reload = () => loadProducts(body, search.value);
  return root;
}

async function loadProducts(bodyEl, q) {
  const root = bodyEl || document.getElementById("prod-body");
  if (!root) return;
  try {
    const rows = await QuoApi.products(q || "");
    fill(root,
      rows.length
        ? h("div", { class: "card table-wrap" }, h("table", { class: "data" },
            h("thead", {}, h("tr", {},
              ["รหัสสินค้า", "ชื่อสินค้า/บริการ", "รายละเอียด", "หน่วย", "ราคาต่อหน่วย", "VAT %", "สถานะ", "จัดการ"]
                .map((t, i) => h("th", { class: i === 4 || i === 5 ? "num" : "" }, t)))),
            h("tbody", {}, rows.map((p) => h("tr", {},
              h("td", { class: "mono" }, p.code || "—"),
              h("td", { class: "primary-cell" }, p.name),
              h("td", { class: "muted small" }, p.description || "—"),
              h("td", {}, p.unit),
              h("td", { class: "num" }, moneyB(p.unit_price)),
              h("td", { class: "num" }, fmtNumber(p.tax_rate)),
              h("td", {}, h("span", { class: "pill " + (p.active ? "s-won" : "s-other") }, p.active ? "ใช้งาน" : "ปิดใช้งาน")),
              h("td", {}, h("div", { class: "row", style: { gap: "4px" } },
                perms().canWrite ? h("button", { class: "btn sm", onclick: () => openProductModal(p, () => loadProducts(document.getElementById("prod-body"), q)) }, "แก้ไข") : null,
                perms().isAdmin ? h("button", { class: "btn sm danger", onclick: async () => {
                  const ok2 = await confirmDialog(`ลบสินค้า "${p.name}"? เอกสารเก่าที่เคยใช้จะยังแสดงข้อมูลเดิม (snapshot) ไว้`, { danger: true, okText: "ลบ" });
                  if (!ok2) return;
                  try { await QuoApi.removeProduct(p.id); toast("ลบสินค้าแล้ว", "success"); loadProducts(document.getElementById("prod-body"), q); }
                  catch (e) { toast(e.message, "error"); }
                } }, "ลบ") : null)
              ))
            ))))
        : quoEmptyCard("ยังไม่มีสินค้าในคลัง", "เพิ่มสินค้า/บริการแรกเพื่อใช้ในใบเสนอราคา",
            perms().canWrite ? [h("button", { class: "btn primary", onclick: () => openProductModal(null, () => loadProducts(document.getElementById("prod-body"), q)) }, "+ เพิ่มสินค้า/บริการ")] : [])
    );
  } catch (e) {
    fill(root, quoErrCard(e));
  }
}

function openProductModal(p, onSaved) {
  const editing = !!p;
  const codeInp = h("input", { type: "text", placeholder: "เช่น SKU-001 (ไม่บังคับสำหรับบริการ)" });
  const nameInp = h("input", { type: "text", placeholder: "ชื่อสินค้า/บริการ *" });
  const descInp = h("textarea", { rows: "2", placeholder: "รายละเอียด" });
  const unitInp = h("input", { type: "text", placeholder: "เช่น ชิ้น, ครั้ง, เดือน" });
  const priceInp = h("input", { type: "number", min: "0", step: "any", placeholder: "0.00" });
  const taxInp = h("input", { type: "number", min: "0", max: "100", step: "any", placeholder: "7" });
  const activeWrap = h("label", { style: { display: "flex", gap: "7px", alignItems: "center", fontWeight: "400" } });
  const activeBox = h("input", { type: "checkbox" });

  if (editing) {
    codeInp.value = p.code || ""; nameInp.value = p.name; descInp.value = p.description || "";
    unitInp.value = p.unit; priceInp.value = p.unit_price; taxInp.value = p.tax_rate;
    activeBox.checked = p.active;
  } else {
    unitInp.value = "หน่วย"; taxInp.value = "7"; activeBox.checked = true;
  }
  activeWrap.append(activeBox, " เปิดใช้งาน (ปิด = ไม่แสดงในตัวเลือกใบเสนอราคา)");
  if (!perms().canWrite) [codeInp, nameInp, descInp, unitInp, priceInp, taxInp, activeBox].forEach((el) => el.disabled = true);

  openModal({
    title: editing ? "แก้ไขสินค้า: " + p.name : "เพิ่มสินค้า/บริการใหม่",
    body: h("div", {},
      h("div", { class: "form-field" }, h("label", {}, "รหัสสินค้า"), codeInp),
      h("div", { class: "form-field" }, h("label", {}, "ชื่อสินค้า/บริการ *"), nameInp),
      h("div", { class: "form-field" }, h("label", {}, "รายละเอียด"), descInp),
      h("div", { class: "form-grid" },
        h("div", { class: "form-field" }, h("label", {}, "หน่วยนับ"), unitInp),
        h("div", { class: "form-field" }, h("label", {}, "ราคาต่อหน่วย (บาท)"), priceInp),
        h("div", { class: "form-field" }, h("label", {}, "อัตราภาษี (%)"), taxInp)),
      h("div", { class: "form-field" }, activeWrap)),
    footer: [
      h("button", { class: "btn", onclick: closeModal }, "ยกเลิก"),
      perms().canWrite ? h("button", {
        class: "btn primary",
        onclick: async () => {
          const name = nameInp.value.trim();
          if (!name) { toast("กรุณากรอกชื่อสินค้า/บริการ", "error"); nameInp.classList.add("err"); return; }
          try {
            await QuoApi.saveProduct({
              code: codeInp.value.trim(), name,
              description: descInp.value.trim(),
              unit: unitInp.value.trim() || "หน่วย",
              unit_price: Number(priceInp.value) || 0,
              tax_rate: taxInp.value === "" ? 7 : Number(taxInp.value),
              active: activeBox.checked
            }, editing ? p.id : null);
            closeModal();
            toast(editing ? "บันทึกสินค้าแล้ว" : "เพิ่มสินค้าแล้ว", "success");
            if (onSaved) onSaved();
          } catch (e) { toast(e.message, "error"); }
        }
      }, "บันทึก") : null
    ]
  });
}
