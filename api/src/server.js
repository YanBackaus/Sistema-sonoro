const path = require("path");
const express = require("express");
const { config } = require("./config");
const {
  cancelFirmwareDeployment,
  createFirmwareRelease,
  createDatabasePool,
  deleteDeviceById,
  getDeveloperDeviceDetails,
  upsertDevice,
  listDeveloperDevices,
  listDevices,
  getDeviceDetails,
  getDeviceAuthRecord,
  getDeviceConfig,
  listFirmwareReleases,
  listSchedulesForDevice,
  createSchedule,
  updateSchedule,
  updateScheduleEnabled,
  deleteSchedule,
  getPendingFirmwareDeployment,
  markFirmwareDeploymentAppliedByVersion,
  markFirmwareDeploymentApplying,
  markFirmwareDeploymentFailed,
  queueFirmwareDeployment,
  updateDeviceHeartbeat,
  insertDeviceEvent,
} = require("./db");
const {
  createSignedSessionToken,
  timingSafeEqualText,
  verifyDeviceApiKey,
  verifySignedSessionToken,
} = require("./security");
const {
  ValidationError,
  normalizeDeviceId,
  normalizeDeveloperPasswordPayload,
  normalizeDevicePayload,
  normalizeSchedulePayload,
  normalizeHeartbeatPayload,
  normalizeEventPayload,
  normalizeFirmwareDeploymentPayload,
  normalizeFirmwareReleasePayload,
  normalizeScheduleId,
  normalizeBoolean,
} = require("./validation");

const app = express();
const pool = createDatabasePool(config.mysql);
const adminAppDirectory = path.resolve(__dirname, "../public/admin");
const adminIndexFile = path.join(adminAppDirectory, "index.html");
const developerAppDirectory = path.resolve(__dirname, "../developer-app");
const developerLoginFile = path.join(developerAppDirectory, "login.html");
const developerPortalFile = path.join(developerAppDirectory, "portal.html");
const developerAssetsDirectory = path.join(developerAppDirectory, "assets");
const DEVELOPER_SESSION_COOKIE = "developer_portal_session";

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(handleRequestParsingError);
app.use((request, response, next) => {
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (
    request.path === "/admin" ||
    request.path.startsWith("/admin/") ||
    request.path === "/developer" ||
    request.path.startsWith("/developer/")
  ) {
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
      developer: "GET /developer/login",
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

app.get("/developer/login", (request, response) => {
  if (getDeveloperSession(request)) {
    response.redirect("/developer");
    return;
  }

  response.sendFile(developerLoginFile);
});

app.use("/developer/assets", express.static(developerAssetsDirectory));

app.get("/developer", requireDeveloperPageSession, (request, response) => {
  response.sendFile(developerPortalFile);
});

app.post("/api/developer/session", async (request, response) => {
  try {
    const { password } = normalizeDeveloperPasswordPayload(request.body || {});
    if (!isDeveloperPasswordValid(password)) {
      response.status(401).json({
        ok: false,
        error: "Senha do desenvolvedor invalida.",
      });
      return;
    }

    const expiresAt = new Date(Date.now() + config.developerSessionTtlHours * 60 * 60 * 1000);
    const token = createSignedSessionToken(
      {
        role: "developer",
        exp: expiresAt.toISOString(),
      },
      config.developerSessionSecret
    );

    response.setHeader("Set-Cookie", serializeDeveloperSessionCookie(token, request, expiresAt));
    response.json({
      ok: true,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/developer/session", requireDeveloperSession, (request, response) => {
  response.json({
    ok: true,
    expires_at: request.developerSession.exp,
  });
});

app.delete("/api/developer/session", (request, response) => {
  response.setHeader("Set-Cookie", clearDeveloperSessionCookie(request));
  response.json({
    ok: true,
  });
});

app.get("/api/developer/overview", requireDeveloperSession, async (request, response) => {
  try {
    const [devices, releases] = await Promise.all([
      listDeveloperDevices(pool),
      listFirmwareReleases(pool),
    ]);

    response.json({
      ok: true,
      summary: {
        total_devices: devices.length,
        online_devices: devices.filter((device) => Boolean(device.last_seen_at)).length,
        total_releases: releases.length,
        pending_deployments: devices.filter((device) =>
          ["pending", "applying"].includes(device.latest_deployment?.status)
        ).length,
      },
      devices,
      releases,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/developer/devices", requireDeveloperSession, async (request, response) => {
  try {
    const devices = await listDeveloperDevices(pool);
    response.json({
      ok: true,
      devices,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/developer/devices/:deviceId", requireDeveloperSession, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const device = await getDeveloperDeviceDetails(pool, deviceId);

    if (!device) {
      response.status(404).json({
        ok: false,
        error: "ESP nao encontrado.",
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

app.post("/api/developer/devices", requireDeveloperSession, async (request, response) => {
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

app.delete("/api/developer/devices/:deviceId", requireDeveloperSession, async (request, response) => {
  try {
    const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
    const removed = await deleteDeviceById(pool, deviceId);

    if (!removed) {
      response.status(404).json({
        ok: false,
        error: "ESP nao encontrado.",
      });
      return;
    }

    response.json({
      ok: true,
      device: removed,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/developer/releases", requireDeveloperSession, async (request, response) => {
  try {
    const releases = await listFirmwareReleases(pool);
    response.json({
      ok: true,
      releases,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/developer/releases", requireDeveloperSession, async (request, response) => {
  try {
    const release = normalizeFirmwareReleasePayload(request.body || {});
    const saved = await createFirmwareRelease(pool, release);

    response.status(201).json({
      ok: true,
      release: saved,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/developer/releases/:releaseId/deploy", requireDeveloperSession, async (request, response) => {
  try {
    const releaseId = normalizeScheduleId(request.params.releaseId);
    const deployment = normalizeFirmwareDeploymentPayload(request.body || {});
    const queued = await queueFirmwareDeployment(pool, releaseId, deployment.device_ids);

    if (!queued) {
      response.status(404).json({
        ok: false,
        error: "Release nao encontrada.",
      });
      return;
    }

    response.status(201).json({
      ok: true,
      release: queued.release,
      created: queued.created,
      device_ids: queued.device_ids,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/developer/deployments/:deploymentId/cancel", requireDeveloperSession, async (request, response) => {
  try {
    const deploymentId = normalizeScheduleId(request.params.deploymentId);
    const cancelled = await cancelFirmwareDeployment(pool, deploymentId);

    if (!cancelled) {
      response.status(404).json({
        ok: false,
        error: "Deployment nao encontrado.",
      });
      return;
    }

    response.json({
      ok: true,
      deployment: cancelled,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

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

    response.json(await buildDeviceSyncPayload(request, device));
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/devices/:deviceId/heartbeat", requireDeviceAccess, async (request, response) => {
  try {
    const deviceId = request.authorizedDeviceId;
    const heartbeat = normalizeHeartbeatPayload(request.body || {});

    const updated = await updateDeviceHeartbeat(pool, deviceId, heartbeat);
    await markFirmwareDeploymentAppliedByVersion(pool, deviceId, heartbeat.firmware_version);
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

    response.json(await buildDeviceSyncPayload(request, device));
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
    await applyFirmwareEventState(deviceId, event);

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

function requireDeveloperPageSession(request, response, next) {
  const session = getDeveloperSession(request);
  if (!session) {
    response.redirect("/developer/login");
    return;
  }

  request.developerSession = session;
  next();
}

function requireDeveloperSession(request, response, next) {
  const session = getDeveloperSession(request);
  if (!session) {
    response.status(401).json({
      ok: false,
      error: "Developer session required.",
    });
    return;
  }

  request.developerSession = session;
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
  const normalized = String(value || "").trim();
  return normalized !== "" && timingSafeEqualText(normalized, config.adminApiKey);
}

function isDeveloperPasswordValid(value) {
  return timingSafeEqualText(String(value || ""), config.developerPassword);
}

function getDeveloperSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[DEVELOPER_SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const payload = verifySignedSessionToken(token, config.developerSessionSecret);
  if (!payload || payload.role !== "developer" || !payload.exp) {
    return null;
  }

  const expiresAt = new Date(payload.exp);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return payload;
}

function parseCookies(cookieHeader) {
  const cookieMap = {};

  for (const part of String(cookieHeader || "").split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name) {
      continue;
    }

    cookieMap[name] = decodeURIComponent(valueParts.join("=") || "");
  }

  return cookieMap;
}

function serializeDeveloperSessionCookie(token, request, expiresAt) {
  const parts = [
    `${DEVELOPER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];

  if (request.secure || request.headers["x-forwarded-proto"] === "https") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearDeveloperSessionCookie(request) {
  const parts = [
    `${DEVELOPER_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (request.secure || request.headers["x-forwarded-proto"] === "https") {
    parts.push("Secure");
  }

  return parts.join("; ");
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

async function buildDeviceSyncPayload(request, device) {
  const pendingDeployment = await getPendingFirmwareDeployment(pool, device.device_id, device.firmware_version);

  return {
    ok: true,
    server_time: new Date().toISOString(),
    device: formatConfigDevice(device),
    schedules: device.schedules,
    ota: pendingDeployment
      ? {
          deployment_id: pendingDeployment.deployment_id,
          version: pendingDeployment.release.version,
          channel: pendingDeployment.release.channel,
          firmware_url: resolveFirmwareUrl(request, pendingDeployment.release.firmware_url),
          sha256: pendingDeployment.release.sha256,
          notes: pendingDeployment.release.notes,
        }
      : null,
  };
}

function resolveFirmwareUrl(request, firmwareUrl) {
  if (!firmwareUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(firmwareUrl)) {
    return firmwareUrl;
  }

  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const protocol = request.headers["x-forwarded-proto"] || (request.secure ? "https" : "http");
  const normalizedPath = firmwareUrl.startsWith("/") ? firmwareUrl : `/${firmwareUrl}`;
  return `${protocol}://${host}${normalizedPath}`;
}

async function applyFirmwareEventState(deviceId, event) {
  if (!event?.event_type) {
    return;
  }

  if (event.event_type === "ota_start") {
    await markFirmwareDeploymentApplying(pool, deviceId);
    return;
  }

  if (event.event_type === "ota_failure") {
    await markFirmwareDeploymentFailed(pool, deviceId, event.message);
    return;
  }

  if (event.event_type === "ota_success" && event.payload?.version) {
    await markFirmwareDeploymentAppliedByVersion(pool, deviceId, event.payload.version);
  }
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
