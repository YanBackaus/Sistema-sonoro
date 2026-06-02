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

function normalizeDevicePayload(payload, defaults) {
  const device_id = normalizeDeviceId(payload.device_id);
  const name = normalizeString(payload.name, 80) || device_id;

  return {
    device_id,
    name,
    location: normalizeString(payload.location, 120),
    menu_title: normalizeString(payload.menu_title, 80) || name,
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

class ValidationError extends Error {}

module.exports = {
  ValidationError,
  normalizeDeviceId,
  normalizeDevicePayload,
  normalizeSchedulePayload,
  normalizeHeartbeatPayload,
  normalizeEventPayload,
  normalizeScheduleId,
  normalizeBoolean,
};
