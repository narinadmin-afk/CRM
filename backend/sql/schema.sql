-- ============================================================
-- schema.sql — สร้างฐานข้อมูลและตารางสำหรับระบบ CRM
-- วิธีใช้:
--   A) รันผ่านคำสั่ง:  npm run db:init   (แนะนำ ไม่ต้องมี mysql client)
--   B) นำเข้าผ่าน GUI เช่น MySQL Workbench / phpMyAdmin
--      (แก้ชื่อฐานข้อมูลด้านล่างให้ตรงกับ DB_NAME ใน .env)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `crm_customers`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `crm_customers`;

CREATE TABLE IF NOT EXISTS `customers` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_code` VARCHAR(20)  NOT NULL,
  `first_name`   VARCHAR(100) NOT NULL,
  `last_name`    VARCHAR(100) NOT NULL,
  `phone`        VARCHAR(20)  DEFAULT NULL,
  `email`        VARCHAR(150) DEFAULT NULL,
  `company`      VARCHAR(150) DEFAULT NULL,
  `address`      VARCHAR(500) DEFAULT NULL,
  `status`       VARCHAR(30)  NOT NULL DEFAULT 'Lead',
  `notes`        VARCHAR(1000) DEFAULT NULL,
  `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_code` (`customer_code`),
  KEY `idx_status` (`status`),
  KEY `idx_name` (`last_name`, `first_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
