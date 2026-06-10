function normalizeDeviceId(value, fieldName = "device_id") {
  const deviceId = String(value || "").trim();

  if (!deviceId) {
    throw new ValidationError(`${fieldName} is required.`);
  }

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) {
    throw new ValidationError(`${fieldName} must contain only letters, numbers, underscore or hyphen.`);
  }

  return deviceId;
}

function normalizeUserId(value, fieldName = "user_id") {
  const userId = String(value || "").trim().toLowerCase();

  if (!userId) {
    throw new ValidationError(`${fieldName} is required.`);
  }

  if (!/^[a-z0-9_-]{3,64}$/.test(userId)) {
    throw new ValidationError(`${fieldName} must contain only lowercase letters, numbers, underscore or hyphen.`);
  }

  return userId;
}

function normalizeDevicePayload(payload, defaults) {
  const device_id = normalizeDeviceId(payload.device_id);
  const name = normalizeString(payload.name, 80) || device_id;
  const location = normalizeString(payload.location, 120);

  return {
    device_id,
    owner_user_id: normalizeOptionalUserId(payload.owner_user_id),
    name,
    location,
    menu_title: location || name,
    hardware_model: normalizeString(payload.hardware_model, 64) || "lolin_d1_mini",
    firmware_profile: normalizeString(payload.firmware_profile, 80) || device_id,
    sound_enabled: normalizeBoolean(payload.sound_enabled, true),
    utc_offset_minutes: normalizeInteger(
      payload.utc_offset_minutes,
      -720,
      840,
      defaults.defaultUtcOffsetMinutes
    ),
    poll_interval_seconds: normalizeInteger(
      payload.poll_interval_seconds,
      15,
      3600,
      defaults.defaultPollIntervalSeconds
    ),
    device_api_key: normalizeOptionalDeviceApiKey(payload.device_api_key),
    rotate_device_api_key: normalizeBoolean(payload.rotate_device_api_key, false),
  };
}

function normalizeUserPayload(payload) {
  const user_id = normalizeUserId(payload.user_id);
  const company_name = normalizeString(payload.company_name, 120);

  if (!company_name) {
    throw new ValidationError("company_name is required.");
  }

  return {
    user_id,
    company_name,
    contact_name: null,
    email: normalizeOptionalEmail(payload.email),
    password: normalizeOptionalPassword(payload.password),
    rotate_password: normalizeBoolean(payload.rotate_password, false),
    status: normalizeUserStatus(payload.status),
  };
}

function normalizeSchedulePayload(payload) {
  const label = normalizeString(payload.label, 80);
  if (!label) {
    throw new ValidationError("label is required.");
  }

  const days_of_week = normalizeDaysOfWeek(payload.days_of_week);

  return {
    label,
    hour: normalizeInteger(payload.hour, 0, 23),
    minute: normalizeInteger(payload.minute, 0, 59),
    days_of_week,
    tone_hz: normalizeInteger(payload.tone_hz, 100, 6000, 2400),
    tone_ms: normalizeInteger(payload.tone_ms, 50, 10000, 600),
    repeat_count: normalizeInteger(payload.repeat_count, 1, 10, 1),
    repeat_gap_ms: normalizeInteger(payload.repeat_gap_ms, 0, 10000, 250),
    enabled: normalizeBoolean(payload.enabled, true),
  };
}

function normalizeHeartbeatPayload(payload) {
  return {
    firmware_version: normalizeString(payload.firmware_version, 32),
    wifi_rssi: payload.wifi_rssi === undefined ? null : normalizeNullableInteger(payload.wifi_rssi),
    ip_address: normalizeString(payload.ip_address, 45),
    current_screen: normalizeString(payload.current_screen, 40),
    current_menu: normalizeString(payload.current_menu, 40),
    local_sound_enabled:
      payload.local_sound_enabled === undefined
        ? null
        : normalizeBoolean(payload.local_sound_enabled),
  };
}

function normalizeEventPayload(payload) {
  const event_type = normalizeString(payload.event_type, 40);
  if (!event_type) {
    throw new ValidationError("event_type is required.");
  }

  return {
    event_type,
    message: normalizeString(payload.message, 160),
    payload: payload.payload === undefined ? null : payload.payload,
    occurred_at: normalizeDateTime(payload.occurred_at),
  };
}

function normalizeDeveloperPasswordPayload(payload) {
  const password = normalizeString(payload.password, 256);
  if (!password) {
    throw new ValidationError("password is required.");
  }

  return { password };
}

function normalizeClientSessionPayload(payload) {
  const company_name = normalizeString(
    payload.company_name ?? payload.identifier ?? payload.user_id,
    120
  );
  const password = normalizeString(payload.password, 256);

  if (!company_name) {
    throw new ValidationError("company_name is required.");
  }

  if (!password) {
    throw new ValidationError("password is required.");
  }

  return { company_name, password };
}

function normalizeClientPasswordChangePayload(payload) {
  const current_password = normalizeString(payload.current_password, 256);
  const new_password = normalizeOptionalPassword(payload.new_password);

  if (!current_password) {
    throw new ValidationError("current_password is required.");
  }

  if (!new_password) {
    throw new ValidationError("new_password is required.");
  }

  return { current_password, new_password };
}

function normalizeFirmwareReleasePayload(payload) {
  const version = normalizeString(payload.version, 32);
  if (!version) {
    throw new ValidationError("version is required.");
  }

  const firmware_url = normalizeFirmwareUrl(payload.firmware_url);
  if (!firmware_url) {
    throw new ValidationError("firmware_url is required.");
  }

  return {
    release_code: normalizeReleaseCode(payload.release_code, version, payload.channel),
    version,
    channel: normalizeString(payload.channel, 32) || "stable",
    target_type: normalizeTargetType(payload.target_type),
    target_user_id: normalizeOptionalUserId(payload.target_user_id),
    target_device_id: normalizeOptionalDeviceId(payload.target_device_id),
    hardware_model: normalizeString(payload.hardware_model, 64) || "lolin_d1_mini",
    binary_filename: normalizeString(payload.binary_filename, 160),
    sketch_path: normalizeString(payload.sketch_path, 255),
    firmware_url,
    sha256: normalizeOptionalSha256(payload.sha256),
    notes: normalizeString(payload.notes, 2000),
  };
}

function normalizeFirmwareDeploymentPayload(payload) {
  const deviceIds = Array.isArray(payload.device_ids)
    ? [...new Set(payload.device_ids.map((item) => normalizeDeviceId(item, "device_ids")))]
    : [];

  return {
    device_ids: deviceIds,
  };
}

function normalizeBuildPlanPayload(payload) {
  const device_id = normalizeDeviceId(payload.device_id);
  const version = normalizeString(payload.version, 32);
  if (!version) {
    throw new ValidationError("version is required.");
  }

  return {
    device_id,
    version,
    channel: normalizeString(payload.channel, 32) || "stable",
  };
}

function normalizeScheduleId(value) {
  return normalizeInteger(value, 1, Number.MAX_SAFE_INTEGER);
}

function normalizeDateTime(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return formatMysqlDate(new Date());
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("date must be valid.");
  }

  return formatMysqlDate(parsed);
}

function formatMysqlDate(date) {
  const iso = date.toISOString();
  return iso.slice(0, 19).replace("T", " ");
}

function normalizeString(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new ValidationError(`value must have at most ${maxLength} characters.`);
  }

  return normalized;
}

function normalizeInteger(value, min, max, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) {
    return fallback;
  }

  const normalized = Number.parseInt(value, 10);

  if (!Number.isInteger(normalized)) {
    throw new ValidationError("value must be an integer.");
  }

  if (normalized < min || normalized > max) {
    throw new ValidationError(`value must be between ${min} and ${max}.`);
  }

  return normalized;
}

function normalizeNullableInteger(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = Number.parseInt(value, 10);
  if (!Number.isInteger(normalized)) {
    throw new ValidationError("value must be an integer.");
  }

  return normalized;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new ValidationError("value must be boolean.");
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  throw new ValidationError("value must be boolean.");
}

function normalizeDaysOfWeek(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("days_of_week must be a non-empty array.");
  }

  const unique = [...new Set(value.map((item) => normalizeInteger(item, 0, 6)))];
  unique.sort((a, b) => a - b);
  return unique;
}

function normalizeOptionalDeviceApiKey(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).trim();
  if (normalized.length < 12 || normalized.length > 128) {
    throw new ValidationError("device_api_key must have between 12 and 128 characters.");
  }

  if (/\s/.test(normalized)) {
    throw new ValidationError("device_api_key must not contain spaces.");
  }

  return normalized;
}

function normalizeOptionalUserId(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  return normalizeUserId(value, "owner_user_id");
}

function normalizeOptionalDeviceId(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  return normalizeDeviceId(value, "target_device_id");
}

function normalizeOptionalEmail(value) {
  const normalized = normalizeString(value, 160);
  if (!normalized) {
    return null;
  }

  const email = normalized.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("email must be valid.");
  }

  return email;
}

function normalizeOptionalPassword(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).trim();
  if (normalized.length < 8 || normalized.length > 128) {
    throw new ValidationError("password must have between 8 and 128 characters.");
  }

  return normalized;
}

function normalizeUserStatus(value) {
  const normalized = normalizeString(value, 20) || "active";
  if (!["active", "paused"].includes(normalized)) {
    throw new ValidationError("status must be active or paused.");
  }

  return normalized;
}

function normalizeTargetType(value) {
  const normalized = normalizeString(value, 16) || "all";
  if (!["all", "user", "device"].includes(normalized)) {
    throw new ValidationError("target_type must be all, user or device.");
  }

  return normalized;
}

function normalizeReleaseCode(value, version, channel) {
  const normalized = normalizeString(value, 80);
  const candidate = normalized || `${String(channel || "stable").toLowerCase()}-${String(version || "").toLowerCase()}`;
  const slug = candidate
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (!slug) {
    throw new ValidationError("release_code is required.");
  }

  return slug;
}

function normalizeFirmwareUrl(value) {
  const normalized = normalizeString(value, 255);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("invalid");
    }
    return parsed.toString();
  } catch (error) {
    throw new ValidationError("firmware_url must be an absolute http(s) URL or a site-relative path.");
  }
}

function normalizeOptionalSha256(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ValidationError("sha256 must contain 64 hexadecimal characters.");
  }

  return normalized;
}

class ValidationError extends Error {}

module.exports = {
  ValidationError,
  normalizeBuildPlanPayload,
  normalizeClientPasswordChangePayload,
  normalizeClientSessionPayload,
  normalizeDeviceId,
  normalizeDevicePayload,
  normalizeDeveloperPasswordPayload,
  normalizeSchedulePayload,
  normalizeHeartbeatPayload,
  normalizeEventPayload,
  normalizeFirmwareDeploymentPayload,
  normalizeFirmwareReleasePayload,
  normalizeUserId,
  normalizeUserPayload,
  normalizeScheduleId,
  normalizeBoolean,
};
