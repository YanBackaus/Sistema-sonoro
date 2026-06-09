const mysql = require("mysql2/promise");
const {
  generateDeviceApiKey,
  generatePortalPassword,
  getKeyLast4,
  hashDeviceApiKey,
  hashPassword,
} = require("./security");

function createDatabasePool(mysqlConfig) {
  const poolConfig = {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    database: mysqlConfig.database,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  };

  if (mysqlConfig.sslEnabled) {
    poolConfig.ssl = {
      minVersion: "TLSv1.2",
      rejectUnauthorized: mysqlConfig.sslRejectUnauthorized,
    };

    if (mysqlConfig.sslCa) {
      poolConfig.ssl.ca = mysqlConfig.sslCa;
    }
  }

  return mysql.createPool(poolConfig);
}

async function upsertDevice(pool, device, securityConfig) {
  const currentAuth = await getDeviceAuthRecord(pool, device.device_id);
  let provisionedKey = null;
  let deviceApiKeyHash = currentAuth?.device_api_key_hash || null;
  let deviceApiKeyLast4 = currentAuth?.device_api_key_last4 || null;

  if (device.device_api_key) {
    provisionedKey = device.device_api_key;
  } else if (device.rotate_device_api_key || !deviceApiKeyHash) {
    provisionedKey = generateDeviceApiKey();
  }

  if (provisionedKey) {
    deviceApiKeyHash = hashDeviceApiKey(provisionedKey, securityConfig.deviceKeyPepper);
    deviceApiKeyLast4 = getKeyLast4(provisionedKey);
  }

  await pool.execute(
    `INSERT INTO devices (
      device_id,
      owner_user_id,
      name,
      location,
      menu_title,
      hardware_model,
      firmware_profile,
      sound_enabled,
      utc_offset_minutes,
      poll_interval_seconds,
      device_api_key_hash,
      device_api_key_last4
    ) VALUES (
      :device_id,
      :owner_user_id,
      :name,
      :location,
      :menu_title,
      :hardware_model,
      :firmware_profile,
      :sound_enabled,
      :utc_offset_minutes,
      :poll_interval_seconds,
      :device_api_key_hash,
      :device_api_key_last4
    )
    ON DUPLICATE KEY UPDATE
      owner_user_id = VALUES(owner_user_id),
      name = VALUES(name),
      location = VALUES(location),
      menu_title = VALUES(menu_title),
      hardware_model = VALUES(hardware_model),
      firmware_profile = VALUES(firmware_profile),
      sound_enabled = VALUES(sound_enabled),
      utc_offset_minutes = VALUES(utc_offset_minutes),
      poll_interval_seconds = VALUES(poll_interval_seconds),
      device_api_key_hash = VALUES(device_api_key_hash),
      device_api_key_last4 = VALUES(device_api_key_last4)`,
    {
      device_id: device.device_id,
      owner_user_id: device.owner_user_id,
      name: device.name,
      location: device.location,
      menu_title: device.menu_title,
      hardware_model: device.hardware_model,
      firmware_profile: device.firmware_profile,
      sound_enabled: device.sound_enabled ? 1 : 0,
      utc_offset_minutes: device.utc_offset_minutes,
      poll_interval_seconds: device.poll_interval_seconds,
      device_api_key_hash: deviceApiKeyHash,
      device_api_key_last4: deviceApiKeyLast4,
    }
  );

  return {
    device: await getDeviceDetails(pool, device.device_id),
    provisioning: provisionedKey
      ? {
          device_api_key: provisionedKey,
          device_api_key_last4: deviceApiKeyLast4,
        }
      : null,
  };
}

async function listDevices(pool) {
  const [rows] = await pool.execute(
    `SELECT
      d.device_id,
      d.owner_user_id,
      d.name,
      d.location,
      d.menu_title,
      d.hardware_model,
      d.firmware_profile,
      d.sound_enabled,
      d.local_sound_enabled,
      d.utc_offset_minutes,
      d.poll_interval_seconds,
      d.last_seen_at,
      d.last_ip,
      d.current_screen,
      d.current_menu,
      d.last_rssi,
      d.firmware_version,
      d.device_api_key_last4,
      CASE WHEN d.device_api_key_hash IS NULL THEN 0 ELSE 1 END AS has_device_api_key,
      cu.company_name AS owner_company_name,
      (
        SELECT COUNT(*)
        FROM device_schedules s
        WHERE s.device_id = d.device_id AND s.enabled = 1
      ) AS active_schedule_count
    FROM devices d
    LEFT JOIN client_users cu ON cu.user_id = d.owner_user_id
    ORDER BY d.device_id`
  );

  return rows.map(formatDeviceRow);
}

async function getDeviceDetails(pool, deviceId) {
  const [deviceRows] = await pool.execute(
    `SELECT
      d.device_id,
      d.owner_user_id,
      d.name,
      d.location,
      d.menu_title,
      d.hardware_model,
      d.firmware_profile,
      d.sound_enabled,
      d.local_sound_enabled,
      d.utc_offset_minutes,
      d.poll_interval_seconds,
      d.last_seen_at,
      d.last_ip,
      d.last_rssi,
      d.firmware_version,
      d.current_screen,
      d.current_menu,
      d.device_api_key_last4,
      CASE WHEN d.device_api_key_hash IS NULL THEN 0 ELSE 1 END AS has_device_api_key,
      cu.company_name AS owner_company_name,
      d.created_at,
      d.updated_at
    FROM devices d
    LEFT JOIN client_users cu ON cu.user_id = d.owner_user_id
    WHERE d.device_id = :device_id`,
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

async function getDeviceAuthRecord(pool, deviceId) {
  const [rows] = await pool.execute(
    `SELECT
      device_id,
      device_api_key_hash,
      device_api_key_last4
    FROM devices
    WHERE device_id = :device_id`,
    { device_id: deviceId }
  );

  return rows.length ? rows[0] : null;
}

async function getDeviceConfig(pool, deviceId) {
  return getDeviceDetails(pool, deviceId);
}

async function listClientUsers(pool) {
  const [rows] = await pool.execute(
    `SELECT
      cu.user_id,
      cu.company_name,
      cu.contact_name,
      cu.email,
      cu.password_temporary,
      cu.status,
      cu.created_at,
      cu.updated_at,
      COUNT(d.device_id) AS device_count
    FROM client_users cu
    LEFT JOIN devices d ON d.owner_user_id = cu.user_id
    GROUP BY
      cu.user_id,
      cu.company_name,
      cu.contact_name,
      cu.email,
      cu.password_temporary,
      cu.status,
      cu.created_at,
      cu.updated_at
    ORDER BY cu.company_name, cu.user_id`
  );

  return rows.map(formatClientUserRow);
}

async function getClientUserById(pool, userId) {
  const [rows] = await pool.execute(
    `SELECT
      cu.user_id,
      cu.company_name,
      cu.contact_name,
      cu.email,
      cu.password_temporary,
      cu.status,
      cu.created_at,
      cu.updated_at,
      COUNT(d.device_id) AS device_count
    FROM client_users cu
    LEFT JOIN devices d ON d.owner_user_id = cu.user_id
    WHERE cu.user_id = :user_id
    GROUP BY
      cu.user_id,
      cu.company_name,
      cu.contact_name,
      cu.email,
      cu.password_temporary,
      cu.status,
      cu.created_at,
      cu.updated_at`,
    { user_id: userId }
  );

  return rows.length ? formatClientUserRow(rows[0]) : null;
}

async function getClientUserDetails(pool, userId) {
  const user = await getClientUserById(pool, userId);
  if (!user) {
    return null;
  }

  const [devices] = await pool.execute(
    `SELECT
      d.device_id,
      d.owner_user_id,
      d.name,
      d.location,
      d.menu_title,
      d.hardware_model,
      d.firmware_profile,
      d.sound_enabled,
      d.local_sound_enabled,
      d.utc_offset_minutes,
      d.poll_interval_seconds,
      d.last_seen_at,
      d.last_ip,
      d.last_rssi,
      d.firmware_version,
      d.current_screen,
      d.current_menu,
      d.device_api_key_last4,
      CASE WHEN d.device_api_key_hash IS NULL THEN 0 ELSE 1 END AS has_device_api_key,
      cu.company_name AS owner_company_name,
      (
        SELECT COUNT(*)
        FROM device_schedules s
        WHERE s.device_id = d.device_id AND s.enabled = 1
      ) AS active_schedule_count,
      d.created_at,
      d.updated_at
    FROM devices d
    LEFT JOIN client_users cu ON cu.user_id = d.owner_user_id
    WHERE d.owner_user_id = :user_id
    ORDER BY d.device_id`,
    { user_id: userId }
  );

  return {
    ...user,
    devices: devices.map(formatDeviceRow),
  };
}

async function getClientUserAuthRecordByIdentifier(pool, identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  const [rows] = await pool.execute(
    `SELECT
      user_id,
      company_name,
      contact_name,
      email,
      password_hash,
      password_temporary,
      status
    FROM client_users
    WHERE user_id = :identifier
    LIMIT 1`,
    { identifier: normalized }
  );

  return rows.length ? rows[0] : null;
}

async function upsertClientUser(pool, user) {
  const existing = await getClientUserAuthRecordByIdentifier(pool, user.user_id);
  let passwordHash = null;
  let provisionedPassword = null;
  let passwordTemporary = existing ? Boolean(existing.password_temporary) : false;

  if (user.password) {
    provisionedPassword = user.password;
    passwordHash = hashPassword(user.password);
    passwordTemporary = false;
  } else if (user.rotate_password || !existing) {
    provisionedPassword = generatePortalPassword();
    passwordHash = hashPassword(provisionedPassword);
    passwordTemporary = true;
  }

  await pool.execute(
    `INSERT INTO client_users (
      user_id,
      company_name,
      contact_name,
      email,
      password_hash,
      password_temporary,
      status
    ) VALUES (
      :user_id,
      :company_name,
      :contact_name,
      :email,
      :password_hash,
      :password_temporary,
      :status
    )
    ON DUPLICATE KEY UPDATE
      company_name = VALUES(company_name),
      contact_name = VALUES(contact_name),
      email = VALUES(email),
      password_hash = COALESCE(VALUES(password_hash), password_hash),
      password_temporary = COALESCE(VALUES(password_temporary), password_temporary),
      status = VALUES(status)`,
    {
      user_id: user.user_id,
      company_name: user.company_name,
      contact_name: user.contact_name,
      email: user.email,
      password_hash: passwordHash,
      password_temporary: passwordHash === null ? null : (passwordTemporary ? 1 : 0),
      status: user.status,
    }
  );

  return {
    user: await getClientUserDetails(pool, user.user_id),
    provisioning: provisionedPassword
      ? {
          password: provisionedPassword,
          temporary: passwordTemporary,
          requires_password_change: passwordTemporary,
        }
      : null,
  };
}

async function updateClientUserPassword(pool, userId, password, passwordTemporary = false) {
  await pool.execute(
    `UPDATE client_users
    SET
      password_hash = :password_hash,
      password_temporary = :password_temporary
    WHERE user_id = :user_id`,
    {
      user_id: userId,
      password_hash: hashPassword(password),
      password_temporary: passwordTemporary ? 1 : 0,
    }
  );

  return getClientUserDetails(pool, userId);
}

async function deleteClientUserById(pool, userId) {
  const existing = await getClientUserDetails(pool, userId);
  if (!existing) {
    return null;
  }

  await pool.execute(
    `UPDATE devices
    SET owner_user_id = NULL
    WHERE owner_user_id = :user_id`,
    { user_id: userId }
  );

  await pool.execute("DELETE FROM client_users WHERE user_id = :user_id", {
    user_id: userId,
  });

  return existing;
}

async function deleteDeviceById(pool, deviceId) {
  const existing = await getDeviceDetails(pool, deviceId);
  if (!existing) {
    return null;
  }

  await pool.execute("DELETE FROM devices WHERE device_id = :device_id", {
    device_id: deviceId,
  });

  return existing;
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

async function updateSchedule(pool, scheduleId, schedule, deviceId = null) {
  const current = await getScheduleById(pool, scheduleId);
  if (!current || (deviceId && current.device_id !== deviceId)) {
    return null;
  }

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

async function updateScheduleEnabled(pool, scheduleId, enabled, deviceId = null) {
  const current = await getScheduleById(pool, scheduleId);
  if (!current || (deviceId && current.device_id !== deviceId)) {
    return null;
  }

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

async function deleteSchedule(pool, scheduleId, deviceId = null) {
  const schedule = await getScheduleById(pool, scheduleId);
  if (!schedule || (deviceId && schedule.device_id !== deviceId)) {
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

async function updateDeviceHeartbeat(pool, deviceId, heartbeat) {
  const [result] = await pool.execute(
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

  return result.affectedRows > 0;
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

async function listFirmwareReleases(pool) {
  const [rows] = await pool.execute(
    `SELECT
      fr.id,
      fr.release_code,
      fr.version,
      fr.channel,
      fr.target_type,
      fr.target_user_id,
      fr.target_device_id,
      fr.hardware_model,
      fr.binary_filename,
      fr.sketch_path,
      fr.firmware_url,
      fr.sha256,
      fr.notes,
      fr.is_active,
      fr.created_at,
      cu.company_name AS target_user_company_name,
      d.name AS target_device_name,
      (
        SELECT COUNT(*)
        FROM device_firmware_deployments dfd
        WHERE dfd.firmware_release_id = fr.id
          AND dfd.status IN ('pending', 'applying')
      ) AS active_deployments
    FROM firmware_releases fr
    LEFT JOIN client_users cu ON cu.user_id = fr.target_user_id
    LEFT JOIN devices d ON d.device_id = fr.target_device_id
    ORDER BY fr.created_at DESC, fr.id DESC`
  );

  return rows.map(formatFirmwareReleaseRow);
}

async function getFirmwareReleaseById(pool, releaseId) {
  const [rows] = await pool.execute(
    `SELECT
      fr.id,
      fr.release_code,
      fr.version,
      fr.channel,
      fr.target_type,
      fr.target_user_id,
      fr.target_device_id,
      fr.hardware_model,
      fr.binary_filename,
      fr.sketch_path,
      fr.firmware_url,
      fr.sha256,
      fr.notes,
      fr.is_active,
      fr.created_at,
      cu.company_name AS target_user_company_name,
      d.name AS target_device_name,
      (
        SELECT COUNT(*)
        FROM device_firmware_deployments dfd
        WHERE dfd.firmware_release_id = fr.id
          AND dfd.status IN ('pending', 'applying')
      ) AS active_deployments
    FROM firmware_releases fr
    LEFT JOIN client_users cu ON cu.user_id = fr.target_user_id
    LEFT JOIN devices d ON d.device_id = fr.target_device_id
    WHERE fr.id = :id`,
    { id: releaseId }
  );

  return rows.length ? formatFirmwareReleaseRow(rows[0]) : null;
}

async function createFirmwareRelease(pool, release) {
  const [result] = await pool.execute(
    `INSERT INTO firmware_releases (
      release_code,
      version,
      channel,
      target_type,
      target_user_id,
      target_device_id,
      hardware_model,
      binary_filename,
      sketch_path,
      firmware_url,
      sha256,
      notes,
      is_active
    ) VALUES (
      :release_code,
      :version,
      :channel,
      :target_type,
      :target_user_id,
      :target_device_id,
      :hardware_model,
      :binary_filename,
      :sketch_path,
      :firmware_url,
      :sha256,
      :notes,
      1
    )
    ON DUPLICATE KEY UPDATE
      release_code = VALUES(release_code),
      firmware_url = VALUES(firmware_url),
      target_type = VALUES(target_type),
      target_user_id = VALUES(target_user_id),
      target_device_id = VALUES(target_device_id),
      hardware_model = VALUES(hardware_model),
      binary_filename = VALUES(binary_filename),
      sketch_path = VALUES(sketch_path),
      sha256 = VALUES(sha256),
      notes = VALUES(notes),
      is_active = 1`,
    {
      release_code: release.release_code,
      version: release.version,
      channel: release.channel,
      target_type: release.target_type,
      target_user_id: release.target_user_id,
      target_device_id: release.target_device_id,
      hardware_model: release.hardware_model,
      binary_filename: release.binary_filename,
      sketch_path: release.sketch_path,
      firmware_url: release.firmware_url,
      sha256: release.sha256,
      notes: release.notes,
    }
  );

  if (result.insertId) {
    return getFirmwareReleaseById(pool, result.insertId);
  }

  const [rows] = await pool.execute(
    `SELECT id
    FROM firmware_releases
    WHERE version = :version
      AND channel = :channel
      AND target_type = :target_type
      AND (
        (target_user_id = :target_user_id)
        OR (target_user_id IS NULL AND :target_user_id IS NULL)
      )
      AND (
        (target_device_id = :target_device_id)
        OR (target_device_id IS NULL AND :target_device_id IS NULL)
      )
    LIMIT 1`,
    {
      version: release.version,
      channel: release.channel,
      target_type: release.target_type,
      target_user_id: release.target_user_id,
      target_device_id: release.target_device_id,
    }
  );

  return rows.length ? getFirmwareReleaseById(pool, rows[0].id) : null;
}

async function listDeveloperDevices(pool) {
  const devices = await listDevices(pool);

  if (!devices.length) {
    return [];
  }

  const [rows] = await pool.execute(
    `SELECT
      dfd.device_id,
      dfd.id AS deployment_id,
      dfd.status AS deployment_status,
      dfd.requested_at,
      dfd.applied_at,
      dfd.failed_at,
      dfd.last_error,
      fr.id AS release_id,
      fr.version AS release_version,
      fr.channel AS release_channel,
      fr.firmware_url
    FROM device_firmware_deployments dfd
    INNER JOIN (
      SELECT device_id, MAX(id) AS latest_id
      FROM device_firmware_deployments
      GROUP BY device_id
    ) latest ON latest.latest_id = dfd.id
    INNER JOIN firmware_releases fr ON fr.id = dfd.firmware_release_id`
  );

  const deploymentMap = new Map(rows.map((row) => [row.device_id, formatFirmwareDeploymentRow(row)]));

  return devices.map((device) => ({
    ...device,
    latest_deployment: deploymentMap.get(device.device_id) || null,
  }));
}

async function getDeveloperDeviceDetails(pool, deviceId) {
  const device = await getDeviceDetails(pool, deviceId);
  if (!device) {
    return null;
  }

  const [rows] = await pool.execute(
    `SELECT
      dfd.id AS deployment_id,
      dfd.device_id,
      dfd.status AS deployment_status,
      dfd.requested_at,
      dfd.applied_at,
      dfd.failed_at,
      dfd.last_error,
      fr.id AS release_id,
      fr.version AS release_version,
      fr.channel AS release_channel,
      fr.firmware_url
    FROM device_firmware_deployments dfd
    INNER JOIN firmware_releases fr ON fr.id = dfd.firmware_release_id
    WHERE dfd.device_id = :device_id
    ORDER BY dfd.id DESC
    LIMIT 10`,
    {
      device_id: deviceId,
    }
  );

  return {
    ...device,
    deployments: rows.map(formatFirmwareDeploymentRow),
  };
}

async function queueFirmwareDeployment(pool, releaseId, deviceIds) {
  const release = await getFirmwareReleaseById(pool, releaseId);
  if (!release) {
    return null;
  }

  let targetDeviceIds = Array.isArray(deviceIds) ? [...new Set(deviceIds)] : [];
  if (release.target_type === "device" && release.target_device_id) {
    if (targetDeviceIds.length && !targetDeviceIds.every((deviceId) => deviceId === release.target_device_id)) {
      return {
        release,
        device_ids: [],
        created: 0,
        error: "Essa release esta travada para um ESP especifico.",
      };
    }

    targetDeviceIds = [release.target_device_id];
  } else if (release.target_type === "user" && release.target_user_id) {
    const [rows] = await pool.execute(
      `SELECT device_id
      FROM devices
      WHERE owner_user_id = :owner_user_id
      ORDER BY device_id`,
      { owner_user_id: release.target_user_id }
    );

    const ownedDeviceIds = rows.map((row) => row.device_id);
    if (targetDeviceIds.length) {
      targetDeviceIds = targetDeviceIds.filter((deviceId) => ownedDeviceIds.includes(deviceId));
    } else {
      targetDeviceIds = ownedDeviceIds;
    }
  } else if (!targetDeviceIds.length) {
    const [rows] = await pool.execute("SELECT device_id FROM devices ORDER BY device_id");
    targetDeviceIds = rows.map((row) => row.device_id);
  }

  if (!targetDeviceIds.length) {
    return {
      release,
      device_ids: [],
      created: 0,
    };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const placeholders = targetDeviceIds.map(() => "?").join(",");
    const [deviceRows] = await connection.query(
      `SELECT device_id
      FROM devices
      WHERE device_id IN (${placeholders})`,
      targetDeviceIds
    );

    const existingDeviceIds = deviceRows.map((row) => row.device_id);

    for (const deviceId of existingDeviceIds) {
      await connection.execute(
        `UPDATE device_firmware_deployments
        SET status = 'cancelled',
            last_error = NULL
        WHERE device_id = :device_id
          AND status IN ('pending', 'applying')`,
        { device_id: deviceId }
      );

      await connection.execute(
        `INSERT INTO device_firmware_deployments (
          device_id,
          firmware_release_id,
          status,
          requested_at,
          created_at,
          updated_at
        ) VALUES (
          :device_id,
          :firmware_release_id,
          'pending',
          UTC_TIMESTAMP(),
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )`,
        {
          device_id: deviceId,
          firmware_release_id: releaseId,
        }
      );
    }

    await connection.commit();

    return {
      release,
      device_ids: existingDeviceIds,
      created: existingDeviceIds.length,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function cancelFirmwareDeployment(pool, deploymentId) {
  const [rows] = await pool.execute(
    `SELECT
      dfd.id AS deployment_id,
      dfd.device_id,
      dfd.status AS deployment_status,
      dfd.requested_at,
      dfd.applied_at,
      dfd.failed_at,
      dfd.last_error,
      fr.id AS release_id,
      fr.version AS release_version,
      fr.channel AS release_channel,
      fr.firmware_url
    FROM device_firmware_deployments dfd
    INNER JOIN firmware_releases fr ON fr.id = dfd.firmware_release_id
    WHERE dfd.id = :id`,
    { id: deploymentId }
  );

  if (!rows.length) {
    return null;
  }

  await pool.execute(
    `UPDATE device_firmware_deployments
    SET status = 'cancelled',
        last_error = NULL
    WHERE id = :id`,
    { id: deploymentId }
  );

  return {
    ...formatFirmwareDeploymentRow(rows[0]),
    status: "cancelled",
  };
}

async function getPendingFirmwareDeployment(pool, deviceId, currentVersion) {
  const [rows] = await pool.execute(
    `SELECT
      dfd.id AS deployment_id,
      dfd.device_id,
      dfd.status AS deployment_status,
      dfd.requested_at,
      dfd.applied_at,
      dfd.failed_at,
      dfd.last_error,
      fr.id AS release_id,
      fr.version AS release_version,
      fr.channel AS release_channel,
      fr.firmware_url,
      fr.sha256,
      fr.notes
    FROM device_firmware_deployments dfd
    INNER JOIN firmware_releases fr ON fr.id = dfd.firmware_release_id
    WHERE dfd.device_id = :device_id
      AND dfd.status IN ('pending', 'applying')
    ORDER BY dfd.id DESC
    LIMIT 1`,
    { device_id: deviceId }
  );

  if (!rows.length) {
    return null;
  }

  const deployment = formatFirmwareDeploymentRow(rows[0]);
  if (currentVersion && deployment.release.version === currentVersion) {
    await markFirmwareDeploymentAppliedByVersion(pool, deviceId, currentVersion);
    return null;
  }

  return deployment;
}

async function markFirmwareDeploymentApplying(pool, deviceId) {
  const latest = await getLatestDeploymentForDevice(pool, deviceId, ["pending", "applying"]);
  if (!latest) {
    return null;
  }

  await pool.execute(
    `UPDATE device_firmware_deployments
    SET status = 'applying',
        last_error = NULL
    WHERE id = :id`,
    { id: latest.deployment_id }
  );

  return {
    ...latest,
    status: "applying",
  };
}

async function markFirmwareDeploymentFailed(pool, deviceId, lastError) {
  const latest = await getLatestDeploymentForDevice(pool, deviceId, ["pending", "applying"]);
  if (!latest) {
    return null;
  }

  await pool.execute(
    `UPDATE device_firmware_deployments
    SET status = 'failed',
        failed_at = UTC_TIMESTAMP(),
        last_error = :last_error
    WHERE id = :id`,
    {
      id: latest.deployment_id,
      last_error: lastError || null,
    }
  );

  return {
    ...latest,
    status: "failed",
    last_error: lastError || null,
  };
}

async function markFirmwareDeploymentAppliedByVersion(pool, deviceId, firmwareVersion) {
  if (!firmwareVersion) {
    return null;
  }

  const [rows] = await pool.execute(
    `SELECT
      dfd.id AS deployment_id,
      dfd.device_id,
      dfd.status AS deployment_status,
      dfd.requested_at,
      dfd.applied_at,
      dfd.failed_at,
      dfd.last_error,
      fr.id AS release_id,
      fr.version AS release_version,
      fr.channel AS release_channel,
      fr.firmware_url
    FROM device_firmware_deployments dfd
    INNER JOIN firmware_releases fr ON fr.id = dfd.firmware_release_id
    WHERE dfd.device_id = :device_id
      AND fr.version = :firmware_version
      AND dfd.status IN ('pending', 'applying', 'failed')
    ORDER BY dfd.id DESC
    LIMIT 1`,
    {
      device_id: deviceId,
      firmware_version: firmwareVersion,
    }
  );

  if (!rows.length) {
    return null;
  }

  await pool.execute(
    `UPDATE device_firmware_deployments
    SET status = 'applied',
        applied_at = UTC_TIMESTAMP(),
        failed_at = NULL,
        last_error = NULL
    WHERE id = :id`,
    { id: rows[0].deployment_id }
  );

  return {
    ...formatFirmwareDeploymentRow(rows[0]),
    status: "applied",
  };
}

async function getLatestDeploymentForDevice(pool, deviceId, statuses) {
  if (!Array.isArray(statuses) || !statuses.length) {
    return null;
  }

  const placeholders = statuses.map(() => "?").join(",");
  const [rows] = await pool.query(
    `SELECT
      dfd.id AS deployment_id,
      dfd.device_id,
      dfd.status AS deployment_status,
      dfd.requested_at,
      dfd.applied_at,
      dfd.failed_at,
      dfd.last_error,
      fr.id AS release_id,
      fr.version AS release_version,
      fr.channel AS release_channel,
      fr.firmware_url
    FROM device_firmware_deployments dfd
    INNER JOIN firmware_releases fr ON fr.id = dfd.firmware_release_id
    WHERE dfd.device_id = ?
      AND dfd.status IN (${placeholders})
    ORDER BY dfd.id DESC
    LIMIT 1`,
    [deviceId, ...statuses]
  );

  return rows.length ? formatFirmwareDeploymentRow(rows[0]) : null;
}

function formatDeviceRow(row) {
  return {
    device_id: row.device_id,
    owner_user_id: row.owner_user_id || null,
    owner_company_name: row.owner_company_name || null,
    name: row.name,
    location: row.location,
    menu_title: row.menu_title,
    hardware_model: row.hardware_model || "lolin_d1_mini",
    firmware_profile: row.firmware_profile || row.device_id,
    sound_enabled: Boolean(row.sound_enabled),
    local_sound_enabled:
      row.local_sound_enabled === null || row.local_sound_enabled === undefined
        ? null
        : Boolean(row.local_sound_enabled),
    utc_offset_minutes: row.utc_offset_minutes,
    poll_interval_seconds: row.poll_interval_seconds,
    last_seen_at: row.last_seen_at,
    last_ip: row.last_ip,
    last_rssi: row.last_rssi,
    firmware_version: row.firmware_version,
    current_screen: row.current_screen,
    current_menu: row.current_menu,
    active_schedule_count: row.active_schedule_count,
    has_device_api_key: Boolean(row.has_device_api_key),
    device_api_key_last4: row.device_api_key_last4 || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function formatClientUserRow(row) {
  return {
    user_id: row.user_id,
    company_name: row.company_name,
    contact_name: row.contact_name || null,
    email: row.email || null,
    password_temporary: Boolean(row.password_temporary),
    status: row.status,
    device_count: Number(row.device_count || 0),
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

function formatFirmwareReleaseRow(row) {
  return {
    id: row.id,
    release_code: row.release_code,
    version: row.version,
    channel: row.channel,
    target_type: row.target_type || "all",
    target_user_id: row.target_user_id || null,
    target_user_company_name: row.target_user_company_name || null,
    target_device_id: row.target_device_id || null,
    target_device_name: row.target_device_name || null,
    hardware_model: row.hardware_model || "lolin_d1_mini",
    binary_filename: row.binary_filename || null,
    sketch_path: row.sketch_path || null,
    firmware_url: row.firmware_url,
    sha256: row.sha256 || null,
    notes: row.notes || null,
    is_active: Boolean(row.is_active),
    active_deployments: row.active_deployments === undefined ? undefined : Number(row.active_deployments || 0),
    created_at: row.created_at,
  };
}

function formatFirmwareDeploymentRow(row) {
  return {
    deployment_id: row.deployment_id,
    device_id: row.device_id,
    status: row.deployment_status,
    requested_at: row.requested_at,
    applied_at: row.applied_at,
    failed_at: row.failed_at,
    last_error: row.last_error || null,
    release: {
      id: row.release_id,
      version: row.release_version,
      channel: row.release_channel,
      firmware_url: row.firmware_url,
      sha256: row.sha256 || null,
      notes: row.notes || null,
    },
  };
}

module.exports = {
  cancelFirmwareDeployment,
  deleteClientUserById,
  createFirmwareRelease,
  createDatabasePool,
  deleteDeviceById,
  getClientUserAuthRecordByIdentifier,
  getClientUserById,
  getClientUserDetails,
  getDeveloperDeviceDetails,
  listClientUsers,
  listDevices,
  listDeveloperDevices,
  listFirmwareReleases,
  getDeviceDetails,
  getDeviceAuthRecord,
  getDeviceConfig,
  getFirmwareReleaseById,
  getPendingFirmwareDeployment,
  listSchedulesForDevice,
  markFirmwareDeploymentAppliedByVersion,
  markFirmwareDeploymentApplying,
  markFirmwareDeploymentFailed,
  queueFirmwareDeployment,
  createSchedule,
  updateSchedule,
  updateScheduleEnabled,
  deleteSchedule,
  upsertClientUser,
  upsertDevice,
  updateClientUserPassword,
  updateDeviceHeartbeat,
  insertDeviceEvent,
};
