/* ============================================================
   routes/customerRoutes.js — เส้นทาง API ลูกค้าทั้งหมด
   GET    /api/customers          ดึงข้อมูลทั้งหมด (?search= &status=)
   GET    /api/customers/search   ค้นหา (?q=)
   GET    /api/customers/:id      ดึงข้อมูลรายบุคคล
   POST   /api/customers          เพิ่มลูกค้า
   PUT    /api/customers/:id      แก้ไขข้อมูลลูกค้า
   DELETE /api/customers/:id      ลบลูกค้า
   ============================================================ */
const { Router } = require("express");
const ctrl = require("../controllers/customerController");
const { validateCreate, validateUpdate } = require("../middleware/validate");

const router = Router();

/* wrap async → ส่ง error ไป error handler กลาง */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/", wrap(ctrl.list));
router.get("/search", wrap(ctrl.search));
router.get("/:id", wrap(ctrl.getById));
router.post("/", validateCreate, wrap(ctrl.create));
router.put("/:id", validateUpdate, wrap(ctrl.update));
router.delete("/:id", wrap(ctrl.remove));

module.exports = router;
