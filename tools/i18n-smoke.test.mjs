/* Smoke test สำหรับ js/i18n.js — รันด้วย node tools/i18n-smoke.test.mjs */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../js/i18n.js", import.meta.url), "utf8");

function loadWithLang(lang) {
  const ctx = {
    localStorage: { getItem: (k) => (k === "cmr_lang" ? lang : null), setItem() {} },
    WeakMap, Set, String, NodeFilter: undefined, document: undefined, console
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.log(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

const th = loadWithLang(null);
eq(th.T("แดชบอร์ด"), "แดชบอร์ด", "th: ไม่แปล");
eq(th.T("สมชาย ใจดี"), "สมชาย ใจดี", "th: ข้อมูลคงเดิม");

const en = loadWithLang("en");
eq(en.T("แดชบอร์ด"), "Dashboard", "en: exact map");
eq(en.T("รายชื่อลูกค้า"), "Customers", "en: exact map 2");
eq(en.T("ออกจากระบบ"), "Sign out", "en: sidebar");
eq(en.T("แสดง 3 จาก 10 ระเบียน"), "Showing 3 of 10 records", "en: rule แสดง x จาก y");
eq(en.T("หน้า 2 จาก 5"), "Page 2 of 5", "en: rule หน้า");
eq(en.T("5 นาทีที่แล้ว"), "5 min ago", "en: part นาที");
eq(en.T("3 ชั่วโมงที่แล้ว"), "3 h ago", "en: part ชั่วโมง");
eq(en.T("2 วันที่แล้ว"), "2 d ago", "en: part วัน"),
eq(en.T('ย้าย "ร้านกาแฟบ้านกล้วย" ไปที่สถานะ ปิดการขาย'), 'Moved "ร้านกาแฟบ้านกล้วย" to status Closed won', "en: rule ย้าย");
eq(en.T('ต้องการลบระเบียน "ร้านกาแฟบ้านกล้วย" ใช่หรือไม่?'), 'Delete record "ร้านกาแฟบ้านกล้วย"?', "en: rule ลบระเบียน");
eq(en.T("สมชาย ใจดี"), "สมชาย ใจดี", "en: ชื่อข้อมูลไม่ถูกแปล");
eq(en.T("อัปเดต 24 ต.ค. 2568"), "Updated 24 ต.ค. 2568", "en: rule อัปเดต");
eq(en.T("ผู้รับผิดชอบทั้งหมด"), "All owners", "en: filter option");
eq(en.i18nLocale(), "en-US", "en locale");

const zh = loadWithLang("zh");
eq(zh.T("แดชบอร์ด"), "仪表盘", "zh: exact map");
eq(zh.T("รายชื่อลูกค้า"), "客户列表", "zh: exact map 2");
eq(zh.T("ออกจากระบบ"), "退出登录", "zh: sidebar");
eq(zh.T("สถานะ"), "状态", "zh: status label");
eq(zh.T("แสดง 3 จาก 10 ระเบียน"), "显示 3 / 10 条记录", "zh: rule แสดง x จาก y");
eq(zh.T("หน้า 2 จาก 5"), "第 2/5 页", "zh: rule หน้า");
eq(zh.T("5 นาทีที่แล้ว"), "5 分钟前", "zh: part นาที");
eq(zh.T("3 วันที่แล้ว"), "3 天前", "zh: part วัน");
eq(zh.T('ย้าย "ร้านกาแฟบ้านกล้วย" ไปที่สถานะ ปิดการขาย'), '已将 "ร้านกาแฟบ้านกล้วย" 移至状态 成交', "zh: rule ย้าย + status");
eq(zh.T("สมชาย ใจดี"), "สมชาย ใจดี", "zh: ชื่อข้อมูลไม่ถูกแปล");
eq(zh.T("Language / ภาษา"), "语言 / Language", "zh: title ภาษา");
eq(zh.i18nLocale(), "zh-CN", "zh locale");

/* คลังจีนต้องครบเท่าอังกฤษทุก key (ที่มีค่าจริง) */
const missingZh = vm.runInContext(`
  (() => {
    const enKeys = Object.keys(I18N_EN).filter((k) => I18N_EN[k]);
    const zhKeys = new Set(Object.keys(I18N_ZH).filter((k) => I18N_ZH[k]));
    return enKeys.filter((k) => !zhKeys.has(k));
  })()
`, en);
eq(JSON.stringify(missingZh), "[]", "zh covers every en key: " + JSON.stringify(missingZh));
const ruleParity = vm.runInContext("I18N_RULES_ZH.length === I18N_RULES.length", en);
eq(ruleParity, true, "zh rules count == en rules count");
const partParity = vm.runInContext("I18N_PARTS_ZH.length === I18N_PARTS.length", en);
eq(partParity, true, "zh parts count == en parts count");

console.log(`\nผลลัพธ์: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
if (fail) process.exit(1);
