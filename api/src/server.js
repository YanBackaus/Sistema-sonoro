const path = require("path");
const express = require("express");
const { config } = require("./config");
const { buildFirmwareBuildPlan } = require("./firmware-build");
const {
  cancelFirmwareDeployment,
  createFirmwareRelease,
  createDatabasePool,
  deleteClientUserById,
  deleteDeviceById,
  getClientUserAuthRecordByIdentifier,
  getClientUserById,
  getClientUserDetails,
  getDeveloperDeviceDetails,
  listClientUsers,
  updateClientUserPassword,
  upsertDevice,
  upsertClientUser,
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
  verifyPassword,
  verifySignedSessionToken,
} = require("./security");
const {
  ValidationError,
  normalizeBuildPlanPayload,
  normalizeClientPasswordChangePayload,
  normalizeClientSessionPayload,
  normalizeDeviceId,
  normalizeDeveloperPasswordPayload,
  normalizeDevicePayload,
  normalizeUserId,
  normalizeUserPayload,
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
const firmwareAssetsDirectory = path.resolve(__dirname, "../public/firmware");
const adminIndexFile = path.join(adminAppDirectory, "index.html");
const developerAppDirectory = path.resolve(__dirname, "../developer-app");
const developerLoginFile = path.join(developerAppDirectory, "login.html");
const developerPortalFile = path.join(developerAppDirectory, "portal.html");
const developerAssetsDirectory = path.join(developerAppDirectory, "assets");
const DEVELOPER_SESSION_COOKIE = "developer_portal_session";
const CLIENT_SESSION_COOKIE = "client_portal_session";

app.set("trust proxy", 1);
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
      clientSession: "POST /api/client/session",
      clientPassword: "PUT /api/client/session/password",
      developer: "GET /developer/login",
      developerBuildPlan: "POST /api/developer/build-plan",
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
app.use("/firmware", express.static(firmwareAssetsDirectory));

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
    const [users, devices, releases] = await Promise.all([
      listClientUsers(pool),
      listDeveloperDevices(pool),
      listFirmwareReleases(pool),
    ]);

    response.json({
      ok: true,
      summary: {
        total_users: users.length,
        total_devices: devices.length,
        online_devices: devices.filter((device) => Boolean(device.last_seen_at)).length,
        total_releases: releases.length,
        pending_deployments: devices.filter((device) =>
          ["pending", "applying"].includes(device.latest_deployment?.status)
        ).length,
      },
      users,
      devices,
      releases,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/client/session", async (request, response) => {
  try {
    const { user_id, password } = normalizeClientSessionPayload(request.body || {});
    const authRecord = await getClientUserAuthRecordByIdentifier(pool, user_id);
    const isAuthorized =
      authRecord &&
      authRecord.status === "active" &&
      verifyPassword(password, authRecord.password_hash);

    if (!isAuthorized) {
      response.status(401).json({
        ok: false,
        error: "Credenciais invalidas.",
      });
      return;
    }

    const user = await getClientUserDetails(pool, authRecord.user_id);
    if (!user) {
      response.status(404).json({
        ok: false,
        error: "Usuario nao encontrado.",
      });
      return;
    }

    const expiresAt = createClientSessionExpiry();
    response.setHeader("Set-Cookie", serializeClientSessionCookie(user, request, expiresAt));
    response.json(buildClientSessionResponse(user, expiresAt));
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/client/session", requireClientSession, async (request, response) => {
  try {
    const user = await getClientUserDetails(pool, request.clientSession.user_id);
    if (!user) {
      response.status(404).json({
        ok: false,
        error: "Usuario nao encontrado.",
      });
      return;
    }

    response.json(buildClientSessionResponse(user, request.clientSession.exp));
  } catch (error) {
    handleApiError(error, response);
  }
});

app.put("/api/client/session/password", requireClientSession, async (request, response) => {
  try {
    const { current_password, new_password } = normalizeClientPasswordChangePayload(request.body || {});
    const authRecord = await getClientUserAuthRecordByIdentifier(pool, request.clientSession.user_id);

    if (!authRecord || authRecord.status !== "active") {
      response.status(404).json({
        ok: false,
        error: "Usuario nao encontrado.",
      });
      return;
    }

    if (!verifyPassword(current_password, authRecord.password_hash)) {
      response.status(401).json({
        ok: false,
        error: "Senha atual invalida.",
      });
      return;
    }

    if (current_password === new_password) {
      response.status(422).json({
        ok: false,
        error: "A nova senha precisa ser diferente da atual.",
      });
      return;
    }

    const user = await updateClientUserPassword(pool, request.clientSession.user_id, new_password, false);
    if (!user) {
      response.status(404).json({
        ok: false,
        error: "Usuario nao encontrado.",
      });
      return;
    }

    const expiresAt = createClientSessionExpiry();
    response.setHeader("Set-Cookie", serializeClientSessionCookie(user, request, expiresAt));
    response.json(buildClientSessionResponse(user, expiresAt));
  } catch (error) {
    handleApiError(error, response);
  }
});

app.delete("/api/client/session", (request, response) => {
  response.setHeader("Set-Cookie", clearSessionCookie(CLIENT_SESSION_COOKIE, request));
  response.json({
    ok: true,
  });
});

app.get("/api/client/devices", requireClientReadySession, async (request, response) => {
  try {
    response.json({
      ok: true,
      devices: request.clientUser.devices || [],
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/client/devices/:deviceId", requireClientReadySession, async (request, response) => {
  try {
    const device = await getClientOwnedDevice(request, response);
    if (!device) {
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

app.get("/api/client/devices/:deviceId/schedules", requireClientReadySession, async (request, response) => {
  try {
    const device = await getClientOwnedDevice(request, response);
    if (!device) {
      return;
    }

    response.json({
      ok: true,
      device_id: device.device_id,
      schedules: device.schedules || [],
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/client/devices/:deviceId/schedules", requireClientReadySession, async (request, response) => {
  try {
    const device = await getClientOwnedDevice(request, response);
    if (!device) {
      return;
    }

    const schedule = normalizeSchedulePayload(request.body || {});
    const saved = await createSchedule(pool, device.device_id, schedule);

    response.status(201).json({
      ok: true,
      schedule: saved,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.put("/api/client/devices/:deviceId/schedules/:scheduleId", requireClientReadySession, async (request, response) => {
  try {
    const device = await getClientOwnedDevice(request, response);
    if (!device) {
      return;
    }

    const scheduleId = normalizeScheduleId(request.params.scheduleId);
    const schedule = normalizeSchedulePayload(request.body || {});
    const updated = await updateSchedule(pool, scheduleId, schedule, device.device_id);

    if (!updated) {
      response.status(404).json({
        ok: false,
        error: "Horario nao encontrado para este ESP.",
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

app.patch(
  "/api/client/devices/:deviceId/schedules/:scheduleId/enabled",
  requireClientReadySession,
  async (request, response) => {
    try {
      const device = await getClientOwnedDevice(request, response);
      if (!device) {
        return;
      }

      const scheduleId = normalizeScheduleId(request.params.scheduleId);
      const enabled = normalizeBoolean(request.body?.enabled);
      const updated = await updateScheduleEnabled(pool, scheduleId, enabled, device.device_id);

      if (!updated) {
        response.status(404).json({
          ok: false,
          error: "Horario nao encontrado para este ESP.",
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
  }
);

app.delete(
  "/api/client/devices/:deviceId/schedules/:scheduleId",
  requireClientReadySession,
  async (request, response) => {
    try {
      const device = await getClientOwnedDevice(request, response);
      if (!device) {
        return;
      }

      const scheduleId = normalizeScheduleId(request.params.scheduleId);
      const removed = await deleteSchedule(pool, scheduleId, device.device_id);

      if (!removed) {
        response.status(404).json({
          ok: false,
          error: "Horario nao encontrado para este ESP.",
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
  }
);

app.get("/api/developer/users", requireDeveloperSession, async (request, response) => {
  try {
    const users = await listClientUsers(pool);
    response.json({
      ok: true,
      users,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.get("/api/developer/users/:userId", requireDeveloperSession, async (request, response) => {
  try {
    const userId = normalizeUserId(request.params.userId, "userId");
    const user = await getClientUserDetails(pool, userId);

    if (!user) {
      response.status(404).json({
        ok: false,
        error: "Usuario nao encontrado.",
      });
      return;
    }

    response.json({
      ok: true,
      user,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.post("/api/developer/users", requireDeveloperSession, async (request, response) => {
  try {
    const user = normalizeUserPayload(request.body || {});
    const existing = await getClientUserById(pool, user.user_id);
    const saved = await upsertClientUser(pool, user);

    response.status(existing ? 200 : 201).json({
      ok: true,
      user: saved.user,
      provisioning: saved.provisioning,
    });
  } catch (error) {
    handleApiError(error, response);
  }
});

app.delete("/api/developer/users/:userId", requireDeveloperSession, async (request, response) => {
  try {
    const userId = normalizeUserId(request.params.userId, "userId");
    const removed = await deleteClientUserById(pool, userId);

    if (!removed) {
      response.status(404).json({
        ok: false,
        error: "Usuario nao encontrado.",
      });
      return;
    }

    response.json({
      ok: true,
      user: removed,
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
    if (device.owner_user_id) {
      const owner = await getClientUserById(pool, device.owner_user_id);
      if (!owner) {
        response.status(404).json({
          ok: false,
          error: "Usuario dono nao encontrado.",
        });
        return;
      }
    }

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
    if (release.target_type === "all") {
      release.target_user_id = null;
      release.target_device_id = null;
    }

    if (release.target_type === "user" && !release.target_user_id) {
      response.status(422).json({
        ok: false,
        error: "target_user_id is required when target_type is user.",
      });
      return;
    }

    if (release.target_type === "user") {
      const targetUser = await getClientUserById(pool, release.target_user_id);
      if (!targetUser) {
        response.status(404).json({
          ok: false,
          error: "Usuario alvo nao encontrado.",
        });
        return;
      }

      release.target_device_id = null;
    }

    if (release.target_type === "device" && !release.target_device_id) {
      response.status(422).json({
        ok: false,
        error: "target_device_id is required when target_type is device.",
      });
      return;
    }

    if (release.target_type === "device") {
      const targetDevice = await getDeviceDetails(pool, release.target_device_id);
      if (!targetDevice) {
        response.status(404).json({
          ok: false,
          error: "ESP alvo nao encontrado.",
        });
        return;
      }

      release.target_user_id = null;
      release.hardware_model = targetDevice.hardware_model || release.hardware_model;
    }

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

    if (queued.error) {
      response.status(422).json({
        ok: false,
        error: queued.error,
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

app.post("/api/developer/build-plan", requireDeveloperSession, async (request, response) => {
  try {
    const buildPlan = normalizeBuildPlanPayload(request.body || {});
    const device = await getDeviceDetails(pool, buildPlan.device_id);

    if (!device) {
      response.status(404).json({
        ok: false,
        error: "ESP nao encontrado.",
      });
      return;
    }

    response.json({
      ok: true,
      plan: buildFirmwareBuildPlan(config, {
        device,
        version: buildPlan.version,
        channel: buildPlan.channel,
        apiBaseUrl: resolveRequestOrigin(request),
      }),
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
    if (device.owner_user_id) {
      const owner = await getClientUserById(pool, device.owner_user_id);
      if (!owner) {
        response.status(404).json({
          ok: false,
          error: "Usuario dono nao encontrado.",
        });
        return;
      }
    }

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

function requireClientSession(request, response, next) {
  const session = getClientSession(request);
  if (!session) {
    response.status(401).json({
      ok: false,
      error: "Sessao do cliente obrigatoria.",
    });
    return;
  }

  request.clientSession = session;
  next();
}

async function requireClientReadySession(request, response, next) {
  const session = getClientSession(request);
  if (!session) {
    response.status(401).json({
      ok: false,
      error: "Sessao do cliente obrigatoria.",
    });
    return;
  }

  try {
    const user = await getClientUserDetails(pool, session.user_id);
    if (!user) {
      response.status(404).json({
        ok: false,
        error: "Usuario nao encontrado.",
      });
      return;
    }

    if (user.status !== "active") {
      response.status(403).json({
        ok: false,
        error: "Conta pausada.",
      });
      return;
    }

    if (user.password_temporary) {
      response.status(403).json({
        ok: false,
        error: "Troque a senha provisoria para continuar.",
        requires_password_change: true,
      });
      return;
    }

    request.clientSession = {
      ...session,
      password_temporary: false,
    };
    request.clientUser = user;
    next();
  } catch (error) {
    handleApiError(error, response);
  }
}

async function getClientOwnedDevice(request, response) {
  const deviceId = normalizeDeviceId(request.params.deviceId, "deviceId");
  const device = await getDeviceDetails(pool, deviceId);

  if (!device || device.owner_user_id !== request.clientSession.user_id) {
    response.status(404).json({
      ok: false,
      error: "ESP nao encontrado.",
    });
    return null;
  }

  return device;
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
  return getSignedSessionFromRequest(request, DEVELOPER_SESSION_COOKIE, config.developerSessionSecret, "developer");
}

function getClientSession(request) {
  return getSignedSessionFromRequest(request, CLIENT_SESSION_COOKIE, config.clientSessionSecret, "client");
}

function createClientSessionExpiry() {
  return new Date(Date.now() + config.clientSessionTtlHours * 60 * 60 * 1000);
}

function createClientSessionToken(user, expiresAt) {
  return createSignedSessionToken(
    {
      role: "client",
      user_id: user.user_id,
      password_temporary: Boolean(user.password_temporary),
      exp: normalizeSessionExpiry(expiresAt),
    },
    config.clientSessionSecret
  );
}

function serializeClientSessionCookie(user, request, expiresAt) {
  return serializeSessionCookie(
    CLIENT_SESSION_COOKIE,
    createClientSessionToken(user, expiresAt),
    request,
    new Date(normalizeSessionExpiry(expiresAt))
  );
}

function buildClientSessionResponse(user, expiresAt) {
  return {
    ok: true,
    user,
    expires_at: normalizeSessionExpiry(expiresAt),
    requires_password_change: Boolean(user?.password_temporary),
  };
}

function getSignedSessionFromRequest(request, cookieName, secret, role) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[cookieName];
  if (!token) {
    return null;
  }

  const payload = verifySignedSessionToken(token, secret);
  if (!payload || payload.role !== role || !payload.exp) {
    return null;
  }

  const expiresAt = new Date(payload.exp);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return payload;
}

function normalizeSessionExpiry(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
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

function serializeSessionCookie(cookieName, token, request, expiresAt) {
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
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

function clearSessionCookie(cookieName, request) {
  const parts = [
    `${cookieName}=`,
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

function serializeDeveloperSessionCookie(token, request, expiresAt) {
  return serializeSessionCookie(DEVELOPER_SESSION_COOKIE, token, request, expiresAt);
}

function clearDeveloperSessionCookie(request) {
  return clearSessionCookie(DEVELOPER_SESSION_COOKIE, request);
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

  const normalizedPath = firmwareUrl.startsWith("/") ? firmwareUrl : `/${firmwareUrl}`;
  return `${resolveRequestOrigin(request)}${normalizedPath}`;
}

function resolveRequestOrigin(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const protocol = request.headers["x-forwarded-proto"] || (request.secure ? "https" : "http");
  return `${protocol}://${host}`;
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
