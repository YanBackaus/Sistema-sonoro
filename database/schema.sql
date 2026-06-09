-- Rode este schema ja conectado ao banco que a API usa hoje.
-- Exemplo local:
-- CREATE DATABASE IF NOT EXISTS esp32_monitor
--   CHARACTER SET utf8mb4
--   COLLATE utf8mb4_general_ci;
-- USE esp32_monitor;

CREATE TABLE IF NOT EXISTS client_users (
    user_id VARCHAR(64) NOT NULL,
    company_name VARCHAR(120) NOT NULL,
    contact_name VARCHAR(80) DEFAULT NULL,
    email VARCHAR(160) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_client_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    owner_user_id VARCHAR(64) DEFAULT NULL,
    name VARCHAR(80) NOT NULL,
    location VARCHAR(120) DEFAULT NULL,
    menu_title VARCHAR(80) DEFAULT NULL,
    hardware_model VARCHAR(64) NOT NULL DEFAULT 'lolin_d1_mini',
    firmware_profile VARCHAR(80) DEFAULT NULL,
    device_api_key_hash CHAR(64) DEFAULT NULL,
    device_api_key_last4 CHAR(4) DEFAULT NULL,
    sound_enabled TINYINT(1) NOT NULL DEFAULT 1,
    local_sound_enabled TINYINT(1) DEFAULT NULL,
    utc_offset_minutes SMALLINT NOT NULL DEFAULT -180,
    poll_interval_seconds INT UNSIGNED NOT NULL DEFAULT 60,
    last_seen_at DATETIME DEFAULT NULL,
    last_ip VARCHAR(45) DEFAULT NULL,
    last_rssi INT DEFAULT NULL,
    firmware_version VARCHAR(32) DEFAULT NULL,
    current_screen VARCHAR(40) DEFAULT NULL,
    current_menu VARCHAR(40) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_devices_device_id (device_id),
    KEY idx_devices_owner_user (owner_user_id),
    CONSTRAINT fk_devices_owner_user
      FOREIGN KEY (owner_user_id) REFERENCES client_users(user_id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @current_schema = DATABASE();

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'device_api_key_hash'
  ),
  'SELECT 1',
  'ALTER TABLE devices ADD COLUMN device_api_key_hash CHAR(64) DEFAULT NULL AFTER menu_title'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'device_api_key_last4'
  ),
  'SELECT 1',
  'ALTER TABLE devices ADD COLUMN device_api_key_last4 CHAR(4) DEFAULT NULL AFTER device_api_key_hash'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'owner_user_id'
  ),
  'SELECT 1',
  'ALTER TABLE devices ADD COLUMN owner_user_id VARCHAR(64) DEFAULT NULL AFTER device_id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'hardware_model'
  ),
  'SELECT 1',
  'ALTER TABLE devices ADD COLUMN hardware_model VARCHAR(64) NOT NULL DEFAULT ''lolin_d1_mini'' AFTER menu_title'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'devices'
      AND COLUMN_NAME = 'firmware_profile'
  ),
  'SELECT 1',
  'ALTER TABLE devices ADD COLUMN firmware_profile VARCHAR(80) DEFAULT NULL AFTER hardware_model'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'devices'
      AND CONSTRAINT_NAME = 'fk_devices_owner_user'
  ),
  'SELECT 1',
  'ALTER TABLE devices ADD CONSTRAINT fk_devices_owner_user FOREIGN KEY (owner_user_id) REFERENCES client_users(user_id) ON DELETE SET NULL'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS device_schedules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    label VARCHAR(80) NOT NULL,
    hour TINYINT UNSIGNED NOT NULL,
    minute TINYINT UNSIGNED NOT NULL,
    days_of_week VARCHAR(20) NOT NULL,
    tone_hz INT UNSIGNED NOT NULL DEFAULT 2400,
    tone_ms INT UNSIGNED NOT NULL DEFAULT 600,
    repeat_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
    repeat_gap_ms INT UNSIGNED NOT NULL DEFAULT 250,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_device_schedules_device_time (device_id, enabled, hour, minute),
    CONSTRAINT fk_device_schedules_device
      FOREIGN KEY (device_id) REFERENCES devices(device_id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    message VARCHAR(160) DEFAULT NULL,
    payload_json LONGTEXT DEFAULT NULL,
    occurred_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_device_events_device_time (device_id, occurred_at),
    CONSTRAINT fk_device_events_device
      FOREIGN KEY (device_id) REFERENCES devices(device_id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS firmware_releases (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    release_code VARCHAR(80) NOT NULL,
    version VARCHAR(32) NOT NULL,
    channel VARCHAR(32) NOT NULL DEFAULT 'stable',
    target_type VARCHAR(16) NOT NULL DEFAULT 'all',
    target_user_id VARCHAR(64) DEFAULT NULL,
    target_device_id VARCHAR(64) DEFAULT NULL,
    hardware_model VARCHAR(64) NOT NULL DEFAULT 'lolin_d1_mini',
    binary_filename VARCHAR(160) DEFAULT NULL,
    sketch_path VARCHAR(255) DEFAULT NULL,
    firmware_url VARCHAR(255) NOT NULL,
    sha256 CHAR(64) DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_firmware_release_code (release_code),
    UNIQUE KEY uq_firmware_release_version_channel (version, channel, target_type, target_user_id, target_device_id),
    KEY idx_firmware_releases_target_user (target_user_id),
    KEY idx_firmware_releases_target_device (target_device_id),
    CONSTRAINT fk_firmware_releases_target_user
      FOREIGN KEY (target_user_id) REFERENCES client_users(user_id)
      ON DELETE SET NULL,
    CONSTRAINT fk_firmware_releases_target_device
      FOREIGN KEY (target_device_id) REFERENCES devices(device_id)
      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND COLUMN_NAME = 'release_code'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD COLUMN release_code VARCHAR(80) NOT NULL DEFAULT ''release-pendente'' AFTER id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND COLUMN_NAME = 'target_type'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD COLUMN target_type VARCHAR(16) NOT NULL DEFAULT ''all'' AFTER channel'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND COLUMN_NAME = 'target_user_id'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD COLUMN target_user_id VARCHAR(64) DEFAULT NULL AFTER target_type'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND COLUMN_NAME = 'target_device_id'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD COLUMN target_device_id VARCHAR(64) DEFAULT NULL AFTER target_user_id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND COLUMN_NAME = 'hardware_model'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD COLUMN hardware_model VARCHAR(64) NOT NULL DEFAULT ''lolin_d1_mini'' AFTER target_device_id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND COLUMN_NAME = 'binary_filename'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD COLUMN binary_filename VARCHAR(160) DEFAULT NULL AFTER hardware_model'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND COLUMN_NAME = 'sketch_path'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD COLUMN sketch_path VARCHAR(255) DEFAULT NULL AFTER binary_filename'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND CONSTRAINT_NAME = 'fk_firmware_releases_target_user'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD CONSTRAINT fk_firmware_releases_target_user FOREIGN KEY (target_user_id) REFERENCES client_users(user_id) ON DELETE SET NULL'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = @current_schema
      AND TABLE_NAME = 'firmware_releases'
      AND CONSTRAINT_NAME = 'fk_firmware_releases_target_device'
  ),
  'SELECT 1',
  'ALTER TABLE firmware_releases ADD CONSTRAINT fk_firmware_releases_target_device FOREIGN KEY (target_device_id) REFERENCES devices(device_id) ON DELETE SET NULL'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS device_firmware_deployments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    firmware_release_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at DATETIME DEFAULT NULL,
    failed_at DATETIME DEFAULT NULL,
    last_error VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_device_firmware_deployments_device_status (device_id, status, id),
    KEY idx_device_firmware_deployments_release_status (firmware_release_id, status, id),
    CONSTRAINT fk_device_firmware_deployments_device
      FOREIGN KEY (device_id) REFERENCES devices(device_id)
      ON DELETE CASCADE,
    CONSTRAINT fk_device_firmware_deployments_release
      FOREIGN KEY (firmware_release_id) REFERENCES firmware_releases(id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS readings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    temperature DECIMAL(5,2) NOT NULL,
    humidity DECIMAL(5,2) NOT NULL,
    display_message VARCHAR(120) DEFAULT NULL,
    wifi_rssi INT DEFAULT NULL,
    recorded_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_device_recorded_at (device_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
