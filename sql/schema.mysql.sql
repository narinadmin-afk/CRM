-- ============================================================
-- schema.mysql.sql — สร้างฐานข้อมูล MySQL สำหรับ CRM หลัก (server.js)
--
-- ตารางชุดเดียวกับที่ server.js สร้างใน SQLite:
--   meta, records, users, sessions
-- หมายเหตุสำคัญ:
--   * created_at / updated_at / expires_at ในแอปเป็น
--     Date.now() (มิลลิวินาที, epoch) จึงใช้ BIGINT — ไม่ใช่ TIMESTAMP
--   * คอลัมน์ *_json เก็บเป็น LONGTEXT (ไม่ใช่ชนิด JSON ของ MySQL)
--     เพื่อให้ได้ค่ากลับเป็นข้อความตรงกับที่ JSON.stringify สร้างไว้
--     (ชนิด JSON ของ MySQL ไม่รักษาลำดับ key และอาจ normalize ค่า)
--     และเนื่องจาก MySQL ไม่ยอมให้ตั้ง DEFAULT บนคอลัมน์ TEXT
--     .activities_json จึงเป็น NOT NULL ธรรมดา — ฝั่งแอปต้องส่งค่าเสมอ
--   * ทุกตารางเป็น InnoDB + utf8mb4 (รองรับภาษาไทย)
--
-- วิธีใช้:
--   mysql -u root -p < sql/schema.mysql.sql
--   หรือนำเข้าผ่าน MySQL Workbench / phpMyAdmin
-- ============================================================

CREATE DATABASE IF NOT EXISTS `cmr`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `cmr`;

-- ------------------------------------------------------------
-- meta: ค่า config แบบ key/value (schema ของฟิลด์, มุมมอง ฯลฯ)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `meta` (
  `key`   VARCHAR(191) NOT NULL,
  `value` LONGTEXT     NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- records: ระเบียนลูกค้า (ฟิลด์ยืดหยุ่นเก็บเป็น JSON ใน values_json)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `records` (
  `id`             VARCHAR(64)  NOT NULL,
  `values_json`    LONGTEXT     NOT NULL,
  `activities_json` LONGTEXT    NOT NULL,
  `created_at`     BIGINT       NOT NULL,
  `updated_at`     BIGINT       NOT NULL,
  `creator_id`     VARCHAR(64)  DEFAULT NULL,
  `creator_name`   VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_records_updated_at` (`updated_at`),
  KEY `idx_records_creator` (`creator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- users: บัญชีผู้ใช้ (รหัสผ่านเป็น scrypt รูปแบบ s1$salt$hash)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            VARCHAR(64)  NOT NULL,
  `username`      VARCHAR(100) NOT NULL,
  `display_name`  VARCHAR(150) NOT NULL,
  `email`         VARCHAR(190) NOT NULL DEFAULT '',
  `avatar`        LONGTEXT     NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role`          VARCHAR(20)  NOT NULL DEFAULT 'member',
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`    BIGINT       NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  KEY `idx_users_role_active` (`role`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- sessions: token ในคุกกี้ cmr_session (หมดอายุตาม expires_at)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `token`      CHAR(64)     NOT NULL,
  `user_id`    VARCHAR(64)  NOT NULL,
  `created_at` BIGINT       NOT NULL,
  `expires_at` BIGINT       NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_sessions_user` (`user_id`),
  KEY `idx_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ระบบใบเสนอราคา (Quotation Management)
-- หมายเหตุ:
--   * ทุกตาราง CREATE IF NOT EXISTS — migration ที่ idempotent
--     รันซ้ำได้ตอน start โดยไม่แตะ/ไม่ลบข้อมูลเดิม
--   * เงินทุกคอลัมน์เป็น DECIMAL(18,2) ตรงกับการคำนวณ 2 ตำแหน่ง
--     ทั้งฝั่งเว็บและฝั่งเซิร์ฟเวอร์ (shared/quotation.js)
--   * issue_date/expiry_date เป็น VARCHAR(10) รูป YYYY-MM-DD
--     (ให้ผลตรงกับค่าที่เบราว์เซอร์ส่งมา และเรียงลำดับ/กรองได้
--      ตามตัวอักษร โดยไม่ติดปัญหา Timezone ของ DATE)
--   * *_snapshot เก็บค่า ณ เวลาสร้างเอกสาร เพื่อรักษาเอกสารเก่า
--     ให้ถูกต้องแม้ข้อมูลลูกค้า/สินค้าจะเปลี่ยนภายหลัง
--   * FK: items/logs → quotations (CASCADE), product_id → products
--     (SET NULL), user_id → users (SET NULL)
--     ส่วน customer_id → records ใช้ INDEX + กฎตรวจสอบฝั่งแอป
--     (server.js ปฏิเสธการลบลูกค้าที่ยังมีเอกสารอ้างอิง)
--     เพราะตาราง records ถูก Reset แบบ bulk ได้จากฟีเจอร์เดิม
-- ============================================================

-- ------------------------------------------------------------
-- products: คลังสินค้า/บริการ (โมดูลใหม่ — เดิมไม่มีตารางสินค้า)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `products` (
  `id`          VARCHAR(64)   NOT NULL,
  `code`        VARCHAR(64)    DEFAULT NULL,        -- บริการทั่วไปอาจไม่มีรหัส
  `name`        VARCHAR(255)  NOT NULL,
  `description` LONGTEXT,                          -- รายละเอียด
  `unit`        VARCHAR(32)    NOT NULL DEFAULT 'หน่วย',
  `unit_price`  DECIMAL(18,2)  NOT NULL DEFAULT 0.00,
  `tax_rate`    DECIMAL(6,2)   NOT NULL DEFAULT 7.00,
  `active`      TINYINT(1)     NOT NULL DEFAULT 1,  -- ปิดการใช้งานแทนการลบ
  `creator_id`  VARCHAR(64)    DEFAULT NULL,
  `creator_name` VARCHAR(255)  DEFAULT NULL,
  `created_at`  BIGINT         NOT NULL,
  `updated_at`  BIGINT         NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_code` (`code`),
  KEY `idx_products_name` (`name`),
  KEY `idx_products_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- quotations: ใบเสนอราคา (เลข QT-YYYY-NNNN ห้ามซ้ำ — UNIQUE)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `quotations` (
  `id`                 VARCHAR(64)   NOT NULL,
  `quotation_number`   VARCHAR(30)   NOT NULL,
  `customer_id`        VARCHAR(64)    DEFAULT NULL,   -- อ้างอิง records.id
  `customer_name`      VARCHAR(255)   NOT NULL,        -- snapshot
  `customer_address`   TEXT,                           -- snapshot
  `customer_tax_id`    VARCHAR(30)    DEFAULT NULL,    -- snapshot
  `contact_name`       VARCHAR(255)   DEFAULT NULL,    -- snapshot
  `contact_email`      VARCHAR(190)   DEFAULT NULL,    -- snapshot
  `contact_phone`      VARCHAR(50)    DEFAULT NULL,    -- snapshot
  `issue_date`         VARCHAR(10)    NOT NULL,        -- YYYY-MM-DD
  `expiry_date`        VARCHAR(10)     DEFAULT NULL,   -- YYYY-MM-DD
  `status`             VARCHAR(20)    NOT NULL DEFAULT 'Draft',
  `tax_mode`           VARCHAR(10)    NOT NULL DEFAULT 'exclusive', -- exclusive|inclusive|none
  `tax_rate`           DECIMAL(6,2)   NOT NULL DEFAULT 7.00,        -- อัตรา VAT ระดับเอกสาร
  `subtotal`           DECIMAL(18,2)  NOT NULL DEFAULT 0.00,        -- ยอดรวมก่อนส่วนลด
  `discount_type`      VARCHAR(10)     DEFAULT NULL,                -- percent|amount (ส่วนลดท้ายเอกสาร)
  `discount_value`     DECIMAL(18,2)   DEFAULT NULL,
  `discount_amount`    DECIMAL(18,2)   NOT NULL DEFAULT 0.00,       -- มูลค่าส่วนลดท้ายเอกสาร
  `taxable_amount`     DECIMAL(18,2)   NOT NULL DEFAULT 0.00,       -- ยอดก่อนคิด VAT (หลังส่วนลด)
  `tax_amount`         DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  `grand_total`        DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  `currency`           VARCHAR(10)     NOT NULL DEFAULT 'THB',
  `payment_terms`      TEXT,
  `notes`              TEXT,
  `owner`              VARCHAR(255)    DEFAULT NULL,   -- ผู้รับผิดชอบ
  `prepared_by`        VARCHAR(255)    DEFAULT NULL,   -- ผู้จัดทำ
  `created_by`         VARCHAR(64)     DEFAULT NULL,   -- users.id
  `created_by_name`    VARCHAR(255)    DEFAULT NULL,
  `approved_by`        VARCHAR(64)     DEFAULT NULL,
  `approved_by_name`   VARCHAR(255)    DEFAULT NULL,
  `approved_at`        BIGINT          DEFAULT NULL,
  `created_at`         BIGINT         NOT NULL,
  `updated_at`         BIGINT         NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quotations_number` (`quotation_number`),
  KEY `idx_quotations_customer` (`customer_id`),
  KEY `idx_quotations_status` (`status`),
  KEY `idx_quotations_issue` (`issue_date`),
  KEY `idx_quotations_expiry` (`expiry_date`),
  KEY `idx_quotations_created_by` (`created_by`),
  KEY `idx_quotations_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- quotation_items: รายการสินค้า (เก็บ snapshot ราคา/รายละเอียด
--   ณ เวลาสร้างเอกสาร — ราคาสินค้าที่เปลี่ยนภายหลังไม่กระทบเอกสารเก่า)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `quotation_items` (
  `id`                    VARCHAR(64)   NOT NULL,
  `quotation_id`          VARCHAR(64) NOT NULL,
  `product_id`            VARCHAR(64)    DEFAULT NULL,
  `product_code_snapshot` VARCHAR(64)    DEFAULT NULL,
  `product_name_snapshot` VARCHAR(255)  NOT NULL,
  `description_snapshot`  LONGTEXT,
  `quantity`              DECIMAL(14,2)  NOT NULL DEFAULT 1.00,
  `unit`                  VARCHAR(32)    NOT NULL DEFAULT 'หน่วย',
  `unit_price`            DECIMAL(18,2)  NOT NULL DEFAULT 0.00,
  `discount_type`         VARCHAR(10)    DEFAULT NULL,  -- percent|amount
  `discount_value`        DECIMAL(18,2)  DEFAULT NULL,
  `tax_rate`              DECIMAL(6,2)   NOT NULL DEFAULT 7.00,
  `line_total`            DECIMAL(18,2)  NOT NULL DEFAULT 0.00, -- ยอดต่อรายการ (ก่อน VAT ตาม tax_mode)
  `sort_order`            INT            NOT NULL DEFAULT 0,
  `created_at`            BIGINT         NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_qitems_quotation` (`quotation_id`),
  CONSTRAINT `fk_qitems_quotation` FOREIGN KEY (`quotation_id`)
    REFERENCES `quotations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qitems_product` FOREIGN KEY (`product_id`)
    REFERENCES `products` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- quotation_activity_logs: ประวัติเหตุการณ์/การเปลี่ยนสถานะ
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `quotation_activity_logs` (
  `id`          VARCHAR(64) NOT NULL,
  `quotation_id` VARCHAR(64) NOT NULL,
  `user_id`     VARCHAR(64)  DEFAULT NULL,
  `user_name`   VARCHAR(255) DEFAULT NULL,
  `action`      VARCHAR(40)  NOT NULL,   -- create|update|status|duplicate|delete
  `old_status`  VARCHAR(20)  DEFAULT NULL,
  `new_status`  VARCHAR(20)  DEFAULT NULL,
  `detail`      TEXT,
  `created_at`  BIGINT      NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_qlogs_quotation` (`quotation_id`, `created_at`),
  CONSTRAINT `fk_qlogs_quotation` FOREIGN KEY (`quotation_id`)
    REFERENCES `quotations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qlogs_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
