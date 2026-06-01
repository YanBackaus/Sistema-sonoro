const mysql = require("mysql2/promise");

function createDatabasePool(mysqlConfig) {
  return mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    database: mysqlConfig.database,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });
}

async function ensureDevice(pool, device) {
  await pool.execute(
    `INSERT INTO devices (
      device_id,
      name,
      menu_title,
      utc_offset_minutes,
      poll_interval_seconds
    ) VALUES (
      :device_id,
      :name,
      :menu_title,
      :utc_offset_minutes,
      :poll_interval_seconds
    )
    ON DUPLICATE KEY UPDATE
      device_id = device_id`,
    {
      device_id: device.device_id,
      name: device.name || device.device_id,
      menu_title: device.menu_title || device.name || device.device_id,
      utc_offset_minutes: device.utc_offset_minutes,
      poll_interval_seconds: device.poll_interval_seconds,
    }
  );
}

async function upsertDevice(pool, device) {
  await pool.execute(
    `INSERT INTO devices (
      device_id,
      name,
      location,
      menu_title,
      sound_enabled,
      utc_offset_minutes,
      poll_interval_seconds
    ) VALUES (
      :device_id,
      :name,
      :location,
      :menu_title,
      :sound_enabled,
      :utc_offset_minutes,
      :poll_interval_seconds
    )
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      location = VALUES(location),
      menu_title = VALUES(menu_title),
      sound_enabled = VALUES(sound_enabled),
      utc_offset_minutes = VALUES(utc_offset_minutes),
      poll_interval_seconds = VALUES(poll_interval_seconds)`,
    {
      device_id: device.device_id,
      name: device.name,
      location: device.location,
      menu_title: device.menu_title,
      sound_enabled: device.sound_enabled ? 1 : 0,
      utc_offset_minutes: device.utc_offset_minutes,
      poll_interval_seconds: device.poll_interval_seconds,
    }
  );

  return getDeviceDetails(pool, device.device_id);
}

async function listDevices(pool) {
  const [rows] = await pool.execute(
    `SELECT
      d.device_id,
      d.name,
      d.location,
      d.sound_enabled,
      d.local_sound_enabled,
      d.utc_offset_minutes,
      d.poll_interval_seconds,
      d.last_seen_at,
      d.current_screen,
      d.last_rssi,
      (
        SELECT COUNT(*)
        FROM device_schedules s
        WHERE s.device_id = d.device_id AND s.enabled = 1
      ) AS active_schedule_count
    FROM devices d
    ORDER BY d.device_id`
  );

  return rows.map(formatDeviceRow);
}

async function getDeviceDetails(pool, deviceId) {
  const [deviceRows] = await pool.execute(
    `SELECT
      device_id,
      name,
      location,
      menu_title,
      sound_enabled,
      local_sound_enabled,
      utc_offset_minutes,
      poll_interval_seconds,
      last_seen_at,
      last_ip,
      last_rssi,
      firmware_version,
      current_screen,
      current_menu,
      created_at,
      updated_at
    FROM devices
    WHERE device_id = :device_id`,
    { device_id: deviceId }
  );

  if (!deviceRows.length) {
    return null;
  }

  const schedules = await listSchedulesForDevice(pool, deviceId);

  return {
    ...formatDeviceRow(deviceRows[0]),
    schedules,
  };
}

async function getDeviceConfig(pool, deviceId, defaults) {
  await ensureDevice(pool, {
    device_id: deviceId,
    name: deviceId,
    menu_title: deviceId,
    utc_offset_minutes: defaults.defaultUtcOffsetMinutes,
    poll_interval_seconds: defaults.defaultPollIntervalSeconds,
  });

  return getDeviceDetails(pool, deviceId);
}

async function listSchedulesForDevice(pool, deviceId) {
  const [rows] = await pool.execute(
    `SELECT
      id,
      device_id,
      label,
      hour,
      minute,
      days_of_week,
      tone_hz,
      tone_ms,
      repeat_count,
      repeat_gap_ms,
      enabled,
      created_at,
      updated_at
    FROM device_schedules
    WHERE device_id = :device_id
    ORDER BY hour, minute, id`,
    { device_id: deviceId }
  );

  return rows.map(formatScheduleRow);
}

async function createSchedule(pool, deviceId, schedule) {
  const [result] = await pool.execute(
    `INSERT INTO device_schedules (
      device_id,
      label,
      hour,
      minute,
      days_of_week,
      tone_hz,
      tone_ms,
      repeat_count,
      repeat_gap_ms,
      enabled
    ) VALUES (
      :device_id,
      :label,
      :hour,
      :minute,
      :days_of_week,
      :tone_hz,
      :tone_ms,
      :repeat_count,
      :repeat_gap_ms,
      :enabled
    )`,
    {
      device_id: deviceId,
      label: schedule.label,
      hour: schedule.hour,
      minute: schedule.minute,
      days_of_week: schedule.days_of_week.join(","),
      tone_hz: schedule.tone_hz,
      tone_ms: schedule.tone_ms,
      repeat_count: schedule.repeat_count,
      repeat_gap_ms: schedule.repeat_gap_ms,
      enabled: schedule.enabled ? 1 : 0,
    }
  );

  return getScheduleById(pool, result.insertId);
}

async function updateSchedule(pool, scheduleId, schedule) {
  await pool.execute(
    `UPDATE device_schedules
    SET
      label = :label,
      hour = :hour,
      minute = :minute,
      days_of_week = :days_of_week,
      tone_hz = :tone_hz,
      tone_ms = :tone_ms,
      repeat_count = :repeat_count,
      repeat_gap_ms = :repeat_gap_ms,
      enabled = :enabled
    WHERE id = :id`,
    {
      id: scheduleId,
      label: schedule.label,
      hour: schedule.hour,
      minute: schedule.minute,
      days_of_week: schedule.days_of_week.join(","),
      tone_hz: schedule.tone_hz,
      tone_ms: schedule.tone_ms,
      repeat_count: schedule.repeat_count,
      repeat_gap_ms: schedule.repeat_gap_ms,
      enabled: schedule.enabled ? 1 : 0,
    }
  );

  return getScheduleById(pool, scheduleId);
}

async function updateScheduleEnabled(pool, scheduleId, enabled) {
  await pool.execute(
    `UPDATE device_schedules
    SET enabled = :enabled
    WHERE id = :id`,
    {
      id: scheduleId,
      enabled: enabled ? 1 : 0,
    }
  );

  return getScheduleById(pool, scheduleId);
}

async function deleteSchedule(pool, scheduleId) {
  const schedule = await getScheduleById(pool, scheduleId);
  if (!schedule) {
    return null;
  }

  await pool.execute("DELETE FROM device_schedules WHERE id = :id", { id: scheduleId });
  return schedule;
}

async function getScheduleById(pool, scheduleId) {
  const [rows] = await pool.execute(
    `SELECT
      id,
      device_id,
      label,
      hour,
      minute,
      days_of_week,
      tone_hz,
      tone_ms,
      repeat_count,
      repeat_gap_ms,
      enabled,
      created_at,
      updated_at
    FROM device_schedules
    WHERE id = :id`,
    { id: scheduleId }
  );

  return rows.length ? formatScheduleRow(rows[0]) : null;
}

async function updateDeviceHeartbeat(pool, deviceId, heartbeat, defaults) {
  await ensureDevice(pool, {
    device_id: deviceId,
    name: deviceId,
    menu_title: deviceId,
    utc_offset_minutes: defaults.defaultUtcOffsetMinutes,
    poll_interval_seconds: defaults.defaultPollIntervalSeconds,
  });

  await pool.execute(
    `UPDATE devices
    SET
      last_seen_at = UTC_TIMESTAMP(),
      last_ip = :last_ip,
      last_rssi = :last_rssi,
      firmware_version = :firmware_version,
      current_screen = :current_screen,
      current_menu = :current_menu,
      local_sound_enabled = :local_sound_enabled
    WHERE device_id = :device_id`,
    {
      device_id: deviceId,
      last_ip: heartbeat.ip_address,
      last_rssi: heartbeat.wifi_rssi,
      firmware_version: heartbeat.firmware_version,
      current_screen: heartbeat.current_screen,
      current_menu: heartbeat.current_menu,
      local_sound_enabled:
        typeof heartbeat.local_sound_enabled === "boolean"
          ? (heartbeat.local_sound_enabled ? 1 : 0)
          : null,
    }
  );
}

async function insertDeviceEvent(pool, deviceId, event) {
  await pool.execute(
    `INSERT INTO device_events (
      device_id,
      event_type,
      message,
      payload_json,
      occurred_at
    ) VALUES (
      :device_id,
      :event_type,
      :message,
      :payload_json,
      :occurred_at
    )`,
    {
      device_id: deviceId,
      event_type: event.event_type,
      message: event.message,
      payload_json:
        event.payload === null || event.payload === undefined
          ? null
          : JSON.stringify(event.payload),
      occurred_at: event.occurred_at,
    }
  );
}

function formatDeviceRow(row) {
  return {
    device_id: row.device_id,
    name: row.name,
    location: row.location,
    menu_title: row.menu_title,
    sound_enabled: Boolean(row.sound_enabled),
    local_sound_enabled:
      row.local_sound_enabled === null ? null : Boolean(row.local_sound_enabled),
    utc_offset_minutes: row.utc_offset_minutes,
    poll_interval_seconds: row.poll_interval_seconds,
    last_seen_at: row.last_seen_at,
    last_ip: row.last_ip,
    last_rssi: row.last_rssi,
    firmware_version: row.firmware_version,
    current_screen: row.current_screen,
    current_menu: row.current_menu,
    active_schedule_count: row.active_schedule_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function formatScheduleRow(row) {
  return {
    id: row.id,
    device_id: row.device_id,
    label: row.label,
    hour: row.hour,
    minute: row.minute,
    days_of_week: String(row.days_of_week)
      .split(",")
      .filter(Boolean)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value)),
    tone_hz: row.tone_hz,
    tone_ms: row.tone_ms,
    repeat_count: row.repeat_count,
    repeat_gap_ms: row.repeat_gap_ms,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

module.exports = {
  createDatabasePool,
  upsertDevice,
  listDevices,
  getDeviceDetails,
  getDeviceConfig,
  listSchedulesForDevice,
  createSchedule,
  updateSchedule,
  updateScheduleEnabled,
  deleteSchedule,
  updateDeviceHeartbeat,
  insertDeviceEvent,
};
