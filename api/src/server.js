const path = require("path");
const express = require("express");
const { config } = require("./config");
const {
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
} = require("./db");
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
const adminAppDirectory = path.resolve(__dirname, "../../dashboard");

app.use(express.json({ limit: "256kb" }));

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
    response.status(500).json({
      ok: false,
      error: "Database health check failed.",
      details: error.message,
    });
  }
});

app.get("/admin", (request, response) => {
  response.sendFile(path.join(adminAppDirectory, "index.html"));
});

app.use("/admin", express.static(adminAppDirectory));

app.get("/api/devices", requireApiKey, async (request, response) => {
  try {
    const devices = await listDevices(pool);
    response.json({
      ok: true,
      devices,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: "Internal server error.",
      details: error.message,
    });
  }
});

app.post("/api/devices", requireApiKey, async (request, response) => {
  try {
    const device = normalizeDevicePayload(request.body || {}, config);
    const saved = await upsertDevice(pool, device);

    response.status(201).json({
      ok: true,
      device: saved,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/devices/:deviceId", requireApiKey, async (request, response) => {
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

app.get("/api/devices/:deviceId/config", requireApiKey, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const device = await getDeviceConfig(pool, deviceId, config);

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

app.post("/api/devices/:deviceId/heartbeat", requireApiKey, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const heartbeat = normalizeHeartbeatPayload(request.body || {});

    await updateDeviceHeartbeat(pool, deviceId, heartbeat, config);
    const device = await getDeviceConfig(pool, deviceId, config);

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

app.post("/api/devices/:deviceId/events", requireApiKey, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const event = normalizeEventPayload(request.body || {});
    await getDeviceConfig(pool, deviceId, config);

    await insertDeviceEvent(pool, deviceId, event);

    response.status(201).json({
      ok: true,
      message: "Event stored.",
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/devices/:deviceId/schedules", requireApiKey, async (request, response) => {
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

app.post("/api/devices/:deviceId/schedules", requireApiKey, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    await getDeviceConfig(pool, deviceId, config);
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

app.put("/api/schedules/:scheduleId", requireApiKey, async (request, response) => {
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

app.patch("/api/schedules/:scheduleId/enabled", requireApiKey, async (request, response) => {
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

app.delete("/api/schedules/:scheduleId", requireApiKey, async (request, response) => {
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

app.listen(config.port, () => {
  console.log(`API running on http://localhost:${config.port}`);
});

function requireApiKey(request, response, next) {
  if (request.headers["x-api-key"] !== config.apiKey) {
    response.status(401).json({
      ok: false,
      error: "Invalid API key.",
    });
    return;
  }

  next();
}

function handleApiError(error, response) {
  if (error instanceof ValidationError) {
    response.status(422).json({
      ok: false,
      error: error.message,
    });
    return;
  }

  response.status(500).json({
    ok: false,
    error: "Internal server error.",
    details: error.message,
  });
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
