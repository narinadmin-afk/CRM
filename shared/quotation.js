/* ============================================================
   CMR Base — shared ระบบใบเสนอราคา
   - สูตรคำนวณราคา (ส่วนลดรายสินค้า / ส่วนลดท้ายเอกสาร / VAT 3 แบบ)
     ใช้ร่วมกันทั้งเบราว์เซอร์และเซิร์ฟเวอร์ → ผลลัพธ์ตรงกันเสมอ
   - จำนวนเงินเป็นภาษาไทย (อ่านเงินบาท/สตางค์)
   - สถานะ + กฎการเปลี่ยนสถานะ + ป้ายกำกับภาษาไทย
   ใช้ได้ทั้งแบบ <script> (globalThis.Quo) และ require() ฝั่งเซิร์ฟเวอร์
   ============================================================ */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.Quo = mod;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {

  /* ---------------- สถานะ ---------------- */
  const STATUS = {
    DRAFT: "Draft",
    SENT: "Sent",
    PENDING: "Pending",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    EXPIRED: "Expired",
    CANCELLED: "Cancelled"
  };

  const STATUS_LABELS = {
    Draft: "ฉบับร่าง",
    Sent: "ส่งให้ลูกค้าแล้ว",
    Pending: "รอการตอบรับ",
    Approved: "อนุมัติแล้ว",
    Rejected: "ไม่อนุมัติ",
    Expired: "หมดอายุ",
    Cancelled: "ยกเลิก"
  };

  const STATUS_ORDER = [
    STATUS.DRAFT, STATUS.SENT, STATUS.PENDING, STATUS.APPROVED,
    STATUS.REJECTED, STATUS.EXPIRED, STATUS.CANCELLED
  ];

  /* สถานะที่ยังแก้ไขเอกสารได้ (Approved/Cancelled ต้องทำสำเนาแก้ไขเท่านั้น) */
  const EDITABLE_STATUSES = [STATUS.DRAFT, STATUS.SENT, STATUS.PENDING, STATUS.REJECTED, STATUS.EXPIRED];

  /** แผนที่สถานะ → สถานะที่เปลี่ยนไปได้ */
  const STATUS_TRANSITIONS = {
    Draft:    [STATUS.SENT, STATUS.CANCELLED],
    Sent:     [STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED, STATUS.CANCELLED],
    Pending:  [STATUS.APPROVED, STATUS.REJECTED, STATUS.CANCELLED],
    Approved: [],
    Rejected: [STATUS.DRAFT],
    Expired:  [STATUS.DRAFT],
    Cancelled:[STATUS.DRAFT]
  };

  const TAX_MODES = {
    exclusive: "ยังไม่รวม VAT",
    inclusive: "รวม VAT แล้ว",
    none: "ไม่คิด VAT"
  };

  const DISCOUNT_TYPES = { percent: "เปอร์เซ็นต์", amount: "จำนวนเงิน" };

  function canChangeStatus(from, to) {
    const list = STATUS_TRANSITIONS[from] || [];
    return list.includes(to);
  }

  /* ---------------- helpers ตัวเลข ---------------- */
  /** ปัดเศษ 2 ตำแหน่งแบบ half-up (ตรงกันทุกฝั่ง) */
  function round2(n) {
    const x = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    return Object.is(x, -0) ? 0 : x;
  }
  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * คำนวณยอดรวมของรายการสินค้า 1 แถว
   * line_total = จำนวน × ราคา  − ส่วนลดรายสินค้า (VAT คำนวณระดับเอกสาร)
   */
  function calcLine(item) {
    const qty = toNum(item.quantity);
    const price = toNum(item.unit_price);
    const gross = round2(qty * price);
    let discount = 0;
    if (item.discount_type === "percent") {
      const pct = Math.min(Math.max(toNum(item.discount_value), 0), 100);
      discount = round2(gross * pct / 100);
    } else if (item.discount_type === "amount") {
      discount = Math.min(Math.max(toNum(item.discount_value), 0), gross);
    }
    const lineTotal = round2(gross - discount);
    return { gross: round2(gross), discount, line_total: lineTotal };
  }

  /**
   * คำนวณสรุปทั้งเอกสารจาก items[]
   *  - subtotal        = ยอดรวมก่อนส่วนลด (ผลรวม gross ของทุกแถว)
   *  - line_discount   = ส่วนลดรายสินค้ารวม
   *  - discount_amount = ส่วนลดท้ายเอกสาร (percent คำนวณจาก subtotal − line_discount)
   *  - taxable_amount  = ยอดหลังหักส่วนลดทั้งหมด (ฐาน VAT)
   *  - tax_amount      = VAT (exclusive: +, inclusive: แยกออกจากฐาน, none: 0)
   *  - grand_total     = ยอดสุทธิ
   *
   * tax_mode:
   *   exclusive — ราคาที่กรอกยังไม่รวม VAT → grand = taxable + vat
   *   inclusive — ราคาที่กรอกรวม VAT แล้ว → grand = taxable (vat แยกโชว์)
   *   none      — ไม่คิด VAT → vat = 0
   */
  function calcTotals(doc) {
    const items = Array.isArray(doc.items) ? doc.items : [];
    let subtotal = 0;
    let lineDiscount = 0;
    for (const it of items) {
      const c = calcLine(it);
      subtotal = round2(subtotal + c.gross);
      lineDiscount = round2(lineDiscount + c.discount);
    }

    /* ส่วนลดท้ายเอกสาร */
    let docDiscount = 0;
    const afterLine = round2(subtotal - lineDiscount);
    if (doc.discount_type === "percent") {
      const pct = Math.min(Math.max(toNum(doc.discount_value), 0), 100);
      docDiscount = round2(afterLine * pct / 100);
    } else if (doc.discount_type === "amount") {
      docDiscount = Math.min(Math.max(toNum(doc.discount_value), 0), afterLine);
    }

    const taxable = round2(afterLine - docDiscount);
    const mode = doc.tax_mode === "inclusive" || doc.tax_mode === "none" ? doc.tax_mode : "exclusive";
    const rate = mode === "none" ? 0 : Math.max(toNum(doc.tax_rate), 0);

    let tax = 0;
    let grand = taxable;
    if (mode === "exclusive") {
      tax = round2(taxable * rate / 100);
      grand = round2(taxable + tax);
    } else if (mode === "inclusive") {
      /* ราคาที่กรอกรวม VAT แล้ว → แยก VAT ออกจากฐาน */
      const net = round2(taxable / (1 + rate / 100));
      tax = round2(taxable - net);
      grand = taxable;
    }
    /* none: tax = 0, grand = taxable อยู่แล้ว */

    return {
      subtotal,
      line_discount_total: lineDiscount,
      discount_amount: docDiscount,
      taxable_amount: taxable,
      tax_amount: tax,
      grand_total: grand,
      tax_mode: mode,
      tax_rate: rate
    };
  }

  /* ---------------- จำนวนเงินภาษาไทย ---------------- */
  const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

  function readDigits(n) {          // อ่านเลข 0–999,999,999,999 (ไม่มีศูนย์นำ)
    let out = "";
    const groups = [];
    let x = Math.floor(Math.abs(n));
    while (x > 0) { groups.push(x % 1000000); x = Math.floor(x / 1000000); }
    for (let g = groups.length - 1; g >= 0; g--) {
      const val = groups[g];
      if (g > 0 && val === 0) { /* ข้ามกลุ่มว่าง แต่ถ้าทุกกลุ่มว่าง handled ข้างนอก */ }
      let s = "";
      let nonzero = false;
      for (let pos = 5; pos >= 0; pos--) {
        const d = Math.floor(val / Math.pow(10, pos)) % 10;
        if (d === 0) continue;
        nonzero = true;
        const place = THAI_PLACES[pos];
        if (pos === 1 && d === 1) s += "สิบ";
        else if (pos === 1 && d === 2) s += "ยี่สิบ";
        else if (pos === 1) s += THAI_DIGITS[d] + "สิบ";
        else s += THAI_DIGITS[d] + place;
      }
      if (nonzero) out += s + (g === 1 ? "ล้าน" : g === 2 ? "ล้านล้าน" : "");
    }
    return out;
  }

  /** แปลงจำนวนเงินเป็นข้อความภาษาไทย เช่น 1234.50 → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์" */
  function bahtText(amount) {
    const n = toNum(amount);
    if (!Number.isFinite(n)) return "";
    const neg = n < 0;
    const abs = Math.abs(round2(n));
    const baht = Math.floor(abs + 1e-9);
    const satang = Math.round((abs - baht) * 100) % 100;

    if (baht === 0 && satang === 0) return (neg ? "ลบ" : "") + "ศูนย์บาทถ้วน";

    let out = "";
    if (baht > 0) {
      let txt = readDigits(baht);
      /* หลักหน่วยเป็น 1 แต่ไม่ใช่เลข 1 ตัวเดียว → อ่านว่า "เอ็ด" (ยี่สิบเอ็ด, หนึ่งร้อยเอ็ด) */
      if (baht !== 1 && baht % 10 === 1) {
        if (txt.endsWith("หนึ่ง")) txt = txt.slice(0, -"หนึ่ง".length) + "เอ็ด";
      }
      out = txt + "บาท";
    }
    if (satang > 0) {
      let s = readDigits(satang);
      if (satang % 10 === 1 && satang !== 1 && s.endsWith("หนึ่ง")) {
        s = s.slice(0, -"หนึ่ง".length) + "เอ็ด";
      }
      out += s + "สตางค์";
    } else {
      out += "ถ้วน";
    }
    return (neg ? "ลบ" : "") + out;
  }

  /* ---------------- รูปแบบเลขที่เอกสาร QT-YYYY-NNNN ---------------- */
  function formatDateISO(d) {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return "";
    const p = (x) => String(x).padStart(2, "0");
    return dt.getFullYear() + "-" + p(dt.getMonth() + 1) + "-" + p(dt.getDate());
  }

  function makeQuotationNumber(year, seq) {
    return "QT-" + year + "-" + String(seq).padStart(4, "0");
  }

  /** ตรวจรูปแบบเลขที่เอกสาร (QT-YYYY-NNNN) */
  function isValidQuotationNumber(s) {
    return /^QT-\d{4}-\d{4}$/.test(String(s || ""));
  }

  /** ตรวจรายการสินค้า 1 รายการ (ใช้ทั้ง client แสดง error และ server ยืนยัน) */
  function validateItem(it) {
    if (!it) return "รายการไม่ถูกต้อง";
    if (!String(it.product_name || "").trim()) return "รายการสินค้าต้องมีชื่อ";
    if (!(toNum(it.quantity) > 0)) return "จำนวนต้องมากกว่า 0";
    if (toNum(it.unit_price) < 0) return "ราคาต่อหน่วยต้องไม่ติดลบ";
    if (it.discount_type === "percent" && (toNum(it.discount_value) < 0 || toNum(it.discount_value) > 100)) {
      return "ส่วนลดเปอร์เซ็นต์ต้องอยู่ระหว่าง 0–100";
    }
    if (it.discount_type === "amount" && toNum(it.discount_value) < 0) return "ส่วนลดต้องไม่ติดลบ";
    return null;
  }

  function validateDocument(doc) {
    if (!doc) return "เอกสารไม่ถูกต้อง";
    if (!String(doc.customer_name || "").trim()) return "ต้องเลือกลูกค้า";
    if (!doc.issue_date) return "ต้องระบุวันที่ออกเอกสาร";
    if (doc.expiry_date && doc.issue_date && doc.expiry_date < doc.issue_date) {
      return "วันหมดอายุต้องมากกว่าหรือเท่ากับวันที่ออกเอกสาร";
    }
    const items = Array.isArray(doc.items) ? doc.items : [];
    if (!items.length) return "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ";
    for (let i = 0; i < items.length; i++) {
      const err = validateItem(items[i]);
      if (err) return `รายการที่ ${i + 1}: ${err}`;
    }
    if (doc.discount_type === "percent" && (toNum(doc.discount_value) < 0 || toNum(doc.discount_value) > 100)) {
      return "ส่วนลดท้ายเอกสารต้องอยู่ระหว่าง 0–100%";
    }
    if (doc.discount_type === "amount" && toNum(doc.discount_value) < 0) return "ส่วนลดท้ายเอกสารต้องไม่ติดลบ";
    if (doc.tax_mode === "exclusive" || doc.tax_mode === "inclusive") {
      const rate = toNum(doc.tax_rate);
      if (rate < 0 || rate > 100) return "อัตรา VAT ต้องอยู่ระหว่าง 0–100%";
    }
    return null;
  }

  /* วันนี้ในรูป YYYY-MM-DD (เวลาเครื่อง) */
  function todayISO() { return formatDateISO(new Date()); }

  /** เอกสารหมดอายุหรือยัง (ใช้ตอน list เพื่อแสดง Expired จริง) */
  function isExpired(doc) {
    if (!doc || !doc.expiry_date) return false;
    if ([STATUS.DRAFT, STATUS.CANCELLED, STATUS.APPROVED, STATUS.REJECTED, STATUS.EXPIRED].includes(doc.status)) {
      return doc.status === STATUS.EXPIRED;
    }
    return doc.expiry_date < todayISO();
  }

  return {
    STATUS, STATUS_LABELS, STATUS_ORDER, STATUS_TRANSITIONS, EDITABLE_STATUSES,
    TAX_MODES, DISCOUNT_TYPES,
    canChangeStatus, round2, toNum, calcLine, calcTotals,
    bahtText,
    formatDateISO, todayISO, makeQuotationNumber, isValidQuotationNumber,
    validateItem, validateDocument, isExpired
  };
});
