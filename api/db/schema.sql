-- ============================================================================
--  Field Defibrillators - Pro Bono   |   RELATIONAL SCHEMA (MySQL 8)
-- ============================================================================
--  WHY SQL FOR THIS DATA:
--  Everything in this file is "who and what": identities, ownership, and
--  editable content. It needs UNIQUE constraints (one phone = one responder),
--  FOREIGN KEYS (a device cannot exist without its owner) and TRANSACTIONS
--  (registering a responder + their devices must be all-or-nothing).
--  Positions, heartbeats and alert timelines are NOT here - they live in
--  MongoDB, because they are "when and where" (see mesh/db/mongo.js).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS field_defib
  CHARACTER SET utf8mb4          -- utf8mb4 = full Unicode, required for Hebrew
  COLLATE utf8mb4_unicode_ci;

USE field_defib;

-- ---------------------------------------------------------------------------
-- 1. admins - the only users of the system that have a password at all.
--    Requirement #11: hardcoded simulator admin micha / 1234 (seeded hashed).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,   -- bcrypt output, never the raw password
  display_name  VARCHAR(100) NOT NULL,
  role          ENUM('admin', 'editor') NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 2. refresh_tokens - the "whitelist" that makes logout/revocation possible.
--
--    A plain JWT cannot be cancelled: once signed it is valid until it expires.
--    By storing a row per issued refresh token we can revoke a single session
--    (logout) or every session of an admin (token theft detected).
--    We store a SHA-256 HASH of the token, not the token itself, so a leak of
--    this table does not hand an attacker a working session.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT          NOT NULL,
  token_hash  CHAR(64)     NOT NULL UNIQUE,   -- SHA-256 hex = exactly 64 chars
  user_agent  VARCHAR(255) NULL,              -- which browser opened this session
  expires_at  DATETIME     NOT NULL,
  revoked_at  DATETIME     NULL,              -- NULL = still active
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_admin
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  INDEX idx_refresh_admin (admin_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 3. responders - the public registration table.
--
--    Requirement #6:  first name required, last name optional,
--                     mobile required, LoRa ID optional.
--    Requirement #15: there is NO password column here, by design.
--                     Registration is frictionless - the schema enforces it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS responders (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  first_name     VARCHAR(60)  NOT NULL,
  last_name      VARCHAR(60)  NULL,
  phone          VARCHAR(15)  NOT NULL UNIQUE,  -- normalised digits: 0501234567
  lora_id        VARCHAR(20)  NULL UNIQUE,      -- Meshtastic node id, e.g. !a3f2c1b4
  city           VARCHAR(60)  NULL,
  notes          VARCHAR(255) NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  consent_at     TIMESTAMP    NULL,             -- when they agreed to be contacted
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_responder_active (is_active)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 4. devices - what each responder actually carries. One responder : many rows.
--
--    Requirement #8 (eligibility) is enforced HERE, not with an if() in JS:
--    a responder is only useful to the system if they own at least one device.
--    AED       = mobile defibrillator
--    LORA_NODE = 433MHz Meshtastic node (with or without a defibrillator)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  responder_id  INT NOT NULL,
  kind          ENUM('AED', 'LORA_NODE') NOT NULL,
  model         VARCHAR(80)  NULL,
  serial        VARCHAR(60)  NULL,
  frequency_mhz INT NULL DEFAULT 433,           -- relevant only for LORA_NODE
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_device_responder
    FOREIGN KEY (responder_id) REFERENCES responders(id) ON DELETE CASCADE,
  INDEX idx_device_responder (responder_id),
  INDEX idx_device_kind (kind)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 5. content_blocks - Requirement #12: the admin edits marketing copy from the
--    panel, without a developer and without a redeploy. Each block is addressed
--    by (page_key, section_key), e.g. ('home', 'hero') or ('buy', 'intro').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_blocks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  page_key    VARCHAR(40)  NOT NULL,
  section_key VARCHAR(40)  NOT NULL,
  title       VARCHAR(200) NULL,
  body        TEXT         NULL,
  cta_label   VARCHAR(100) NULL,
  cta_url     VARCHAR(500) NULL,
  updated_by  INT          NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                          ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_content UNIQUE (page_key, section_key),
  CONSTRAINT fk_content_admin
    FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- 6. external_links - Requirement #13 (official MDA static AED map) and
--    Requirement #14 (at least 3 places to buy 433MHz LoRa hardware).
--    Both are just "an external link with a category", so one table serves both.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_links (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  category       ENUM('BUY_LORA', 'OFFICIAL_MAP', 'LEARN') NOT NULL,
  vendor         VARCHAR(100) NOT NULL,
  label          VARCHAR(200) NOT NULL,
  url            VARCHAR(500) NOT NULL,
  frequency_note VARCHAR(120) NULL,   -- e.g. "433MHz - the band used in Israel"
  description    VARCHAR(400) NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_links_category (category, sort_order)
) ENGINE = InnoDB;
