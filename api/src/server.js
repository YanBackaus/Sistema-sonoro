const path = require("path");
const express = require("express");
const { config } = require("./config");
const {
  createDatabasePool,
  upsertDevice,
  listDevices,
  getDeviceDetails,
  getDeviceAuthRecord,
  getDeviceConfig,
  listSchedulesForDevice,
  createSchedule,
  updateSchedule,
  updateScheduleEnabled,
  deleteSchedule,
  updateDeviceHeartbeat,
  insertDeviceEvent,
} = require("./db");
const { verifyDeviceApiKey } = require("./security");
const {
  ValidationError,
  normalizeDeviceId,
  normalizeDevicePayload,
  normalizeSchedulePayload,
  normalizeHeartbeatPayload,
  normalizeEventPayload,
  normalizeScheduleId,
  normalizeBoolean,
} = require("./validation");

const app = express();
const pool = createDatabasePool(config.mysql);
const adminAppDirectory = path.resolve(__dirname, "../public/admin");
const adminIndexFile = path.join(adminAppDirectory, "index.html");

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(handleRequestParsingError);
app.use((request, response, next) => {
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (request.path === "/admin" || request.path.startsWith("/admin/")) {
    response.setHeader("Cache-Control", "no-store");
  }

  next();
});

app.get("/", (request, response) => {
  response.json({
    ok: true,
    service: "d1-mini-scheduler-api",
    message: "API online para agenda sonora dos D1 mini.",
    routes: {
      health: "GET /health",
      devices: "GET /api/devices",
      registerDevice: "POST /api/devices",
      deviceConfig: "GET /api/devices/:deviceId/config",
      heartbeat: "POST /api/devices/:deviceId/heartbeat",
      deviceEvents: "POST /api/devices/:deviceId/events",
      schedules: "GET/POST /api/devices/:deviceId/schedules",
      scheduleEdit: "PUT/PATCH/DELETE /api/devices/:deviceId/schedules/:scheduleId",
    },
  });
});

app.get("/health", async (request, response) => {
  try {
    await pool.query("SELECT 1");

    response.json({
      ok: true,
      service: "d1-mini-scheduler-api",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    response.status(500).json(buildInternalErrorPayload(error, "Database health check failed."));
  }
});

app.get("/admin", (request, response) => {
  response.sendFile(adminIndexFile);
});

app.use("/admin", express.static(adminAppDirectory));

app.get("/api/devices", requireAdminAccess, async (request, response) => {
  try {
    const devices = await listDevices(pool);
    response.json({
      ok: true,
      devices,
    });
  } catch (error) {
    response.status(500).json(buildInternalErrorPayload(error));
  }
});

app.post("/api/devices", requireAdminAccess, async (request, response) => {
  try {
    const device = normalizeDevicePayload(request.body || {}, config);
    const saved = await upsertDevice(pool, device, config);

    response.status(201).json({
      ok: true,
      device: saved.device,
      provisioning: saved.provisioning,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/devices/:deviceId", requireAdminAccess, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const device = await getDeviceDetails(pool, deviceId);

    if (!device) {
      response.status(404).json({
        ok: false,
        error: "Device not found.",
      });
      return;
    }

    response.json({
      ok: true,
      device,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/devices/:deviceId/config", requireDeviceAccess, async (request, response) => {
  try {
    const deviceId = request.authorizedDeviceId;
    const device = await getDeviceConfig(pool, deviceId);

    if (!device) {
      response.status(404).json({
        ok: false,
        error: "Device not found.",
      });
      return;
    }

    response.json({
      ok: true,
      server_time: new Date().toISOString(),
      device: formatConfigDevice(device),
      schedules: device.schedules,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/devices/:deviceId/heartbeat", requireDeviceAccess, async (request, response) => {
  try {
    const deviceId = request.authorizedDeviceId;
    const heartbeat = normalizeHeartbeatPayload(request.body || {});

    const updated = await updateDeviceHeartbeat(pool, deviceId, heartbeat);
    if (!updated) {
      response.status(404).json({
        ok: false,
        error: "Device not found.",
      });
      return;
    }

    const device = await getDeviceConfig(pool, deviceId);
    if (!device) {
      response.status(404).json({
        ok: false,
        error: "Device not found.",
      });
      return;
    }

    response.json({
      ok: true,
      server_time: new Date().toISOString(),
      device: formatConfigDevice(device),
      schedules: device.schedules,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/devices/:deviceId/events", requireDeviceAccess, async (request, response) => {
  try {
    const deviceId = request.authorizedDeviceId;
    const event = normalizeEventPayload(request.body || {});
    const device = await getDeviceConfig(pool, deviceId);

    if (!device) {
      response.status(404).json({
        ok: false,
        error: "Device not found.",
      });
      return;
    }

    await insertDeviceEvent(pool, deviceId, event);

    response.status(201).json({
      ok: true,
      message: "Event stored.",
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/devices/:deviceId/schedules", requireAdminAccess, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const schedules = await listSchedulesForDevice(pool, deviceId);

    response.json({
      ok: true,
      device_id: deviceId,
      schedules,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/devices/:deviceId/schedules", requireAdminAccess, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const device = await getDeviceConfig(pool, deviceId);
    if (!device) {
      response.status(404).json({
        ok: false,
        error: "Device not found.",
      });
      return;
    }

    const schedule = normalizeSchedulePayload(request.body || {});
    const saved = await createSchedule(pool, deviceId, schedule);

    response.status(201).json({
      ok: true,
      schedule: saved,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.put("/api/devices/:deviceId/schedules/:scheduleId", requireAdminAccess, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const scheduleId = normalizeScheduleId(request.params.scheduleId);
    const schedule = normalizeSchedulePayload(request.body || {});
    const updated = await updateSchedule(pool, scheduleId, schedule, deviceId);

    if (!updated) {
      response.status(404).json({
        ok: false,
        error: "Schedule not found for this device.",
      });
      return;
    }

    response.json({
      ok: true,
      schedule: updated,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.patch("/api/devices/:deviceId/schedules/:scheduleId/enabled", requireAdminAccess, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const scheduleId = normalizeScheduleId(request.params.scheduleId);
    const enabled = normalizeBoolean(request.body?.enabled);
    const updated = await updateScheduleEnabled(pool, scheduleId, enabled, deviceId);

    if (!updated) {
      response.status(404).json({
        ok: false,
        error: "Schedule not found for this device.",
      });
      return;
    }

    response.json({
      ok: true,
      schedule: updated,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.delete("/api/devices/:deviceId/schedules/:scheduleId", requireAdminAccess, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const scheduleId = normalizeScheduleId(request.params.scheduleId);
    const removed = await deleteSchedule(pool, scheduleId, deviceId);

    if (!removed) {
      response.status(404).json({
        ok: false,
        error: "Schedule not found for this device.",
      });
      return;
    }

    response.json({
      ok: true,
      schedule: removed,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.put("/api/schedules/:scheduleId", requireAdminAccess, async (request, response) => {
  try {
    const scheduleId = normalizeScheduleId(request.params.scheduleId);
    const schedule = normalizeSchedulePayload(request.body || {});
    const updated = await updateSchedule(pool, scheduleId, schedule);

    if (!updated) {
      response.status(404).json({
        ok: false,
        error: "Schedule not found.",
      });
      return;
    }

    response.json({
      ok: true,
      schedule: updated,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.patch("/api/schedules/:scheduleId/enabled", requireAdminAccess, async (request, response) => {
  try {
    const scheduleId = normalizeScheduleId(request.params.scheduleId);
    const enabled = normalizeBoolean(request.body?.enabled);
    const updated = await updateScheduleEnabled(pool, scheduleId, enabled);

    if (!updated) {
      response.status(404).json({
        ok: false,
        error: "Schedule not found.",
      });
      return;
    }

    response.json({
      ok: true,
      schedule: updated,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.delete("/api/schedules/:scheduleId", requireAdminAccess, async (request, response) => {
  try {
    const scheduleId = normalizeScheduleId(request.params.scheduleId);
    const removed = await deleteSchedule(pool, scheduleId);

    if (!removed) {
      response.status(404).json({
        ok: false,
        error: "Schedule not found.",
      });
      return;
    }

    response.json({
      ok: true,
      schedule: removed,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.use((request, response) => {
  response.status(404).json({
    ok: false,
    error: "Route not found.",
  });
});

app.use(handleUnexpectedError);

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`API running on http://localhost:${config.port}`);
  });
}

function requireAdminAccess(request, response, next) {
  if (!isAdminKeyValid(request.headers["x-api-key"])) {
    response.status(401).json({
      ok: false,
      error: "Invalid admin API key.",
    });
    return;
  }

  next();
}

async function requireDeviceAccess(request, response, next) {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");

    if (isAdminKeyValid(request.headers["x-api-key"])) {
      request.authorizedDeviceId = deviceId;
      next();
      return;
    }

    const deviceKey = String(request.headers["x-device-key"] || "").trim();
    if (!deviceKey) {
      response.status(401).json({
        ok: false,
        error: "Invalid device credentials.",
      });
      return;
    }

    const authRecord = await getDeviceAuthRecord(pool, deviceId);
    const isAuthorized =
      authRecord &&
      authRecord.device_api_key_hash &&
      verifyDeviceApiKey(deviceKey, authRecord.device_api_key_hash, config.deviceKeyPepper);

    if (!isAuthorized) {
      response.status(401).json({
        ok: false,
        error: "Invalid device credentials.",
      });
      return;
    }

    request.authorizedDeviceId = deviceId;
    next();
  } catch (error) {
    handleApiError(error, response);
  }
}

function isAdminKeyValid(value) {
  return String(value || "").trim() !== "" && value === config.adminApiKey;
}

function handleRequestParsingError(error, request, response, next) {
  if (error?.type === "entity.parse.failed" || error instanceof SyntaxError) {
    response.status(400).json({
      ok: false,
      error: "Malformed JSON body.",
    });
    return;
  }

  next(error);
}

function handleApiError(error, response) {
  if (error instanceof ValidationError) {
    response.status(422).json({
      ok: false,
      error: error.message,
    });
    return;
  }

  response.status(500).json(buildInternalErrorPayload(error));
}

function handleUnexpectedError(error, request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ValidationError) {
    response.status(422).json({
      ok: false,
      error: error.message,
    });
    return;
  }

  response.status(500).json(buildInternalErrorPayload(error));
}

function buildInternalErrorPayload(error, message = "Internal server error.") {
  const payload = {
    ok: false,
    error: message,
  };

  if (config.exposeErrorDetails && error?.message) {
    payload.details = error.message;
  }

  return payload;
}

function formatConfigDevice(device) {
  return {
    device_id: device.device_id,
    name: device.name,
    menu_title: device.menu_title,
    sound_enabled: device.sound_enabled,
    local_sound_enabled: device.local_sound_enabled,
    utc_offset_minutes: device.utc_offset_minutes,
    poll_interval_seconds: device.poll_interval_seconds,
    last_seen_at: device.last_seen_at,
  };
}

module.exports = app;
