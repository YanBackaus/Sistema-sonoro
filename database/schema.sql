CREATE DATABASE IF NOT EXISTS esp32_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE esp32_monitor;

CREATE TABLE IF NOT EXISTS devices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    name VARCHAR(80) NOT NULL,
    location VARCHAR(120) DEFAULT NULL,
    menu_title VARCHAR(80) DEFAULT NULL,
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
    UNIQUE KEY uq_devices_device_id (device_id)
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
