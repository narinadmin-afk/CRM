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
