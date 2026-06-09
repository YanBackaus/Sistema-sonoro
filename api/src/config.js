const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function getOptionalEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

const adminApiKey = getOptionalEnv("ADMIN_API_KEY") || getRequiredEnv("API_KEY");
const deviceKeyPepper = getOptionalEnv("DEVICE_KEY_PEPPER") || adminApiKey;
const developerPassword = getOptionalEnv("DEVELOPER_PASSWORD") || adminApiKey;
const developerSessionSecret = getOptionalEnv("DEVELOPER_SESSION_SECRET") || deviceKeyPepper;
const clientSessionSecret = getOptionalEnv("CLIENT_SESSION_SECRET") || developerSessionSecret;
const projectRoot = path.resolve(__dirname, "../..");

const config = {
  port: Number(process.env.PORT || 3000),
  adminApiKey,
  deviceKeyPepper,
  developerPassword,
  developerSessionSecret,
  clientSessionSecret,
  developerSessionTtlHours: Number(process.env.DEVELOPER_SESSION_TTL_HOURS || 12),
  clientSessionTtlHours: Number(process.env.CLIENT_SESSION_TTL_HOURS || 12),
  exposeErrorDetails: parseBooleanEnv(process.env.EXPOSE_ERROR_DETAILS, false),
  defaultUtcOffsetMinutes: Number(process.env.DEFAULT_UTC_OFFSET_MINUTES || -180),
  defaultPollIntervalSeconds: Number(process.env.DEFAULT_POLL_INTERVAL_SECONDS || 60),
  firmwareBuild: {
    sketchPath:
      getOptionalEnv("FIRMWARE_SKETCH_PATH") ||
      path.join(projectRoot, "esp32", "esp32_oled_mysql_firebase", "esp32_oled_mysql_firebase.ino"),
    outputDirectory:
      getOptionalEnv("FIRMWARE_OUTPUT_DIRECTORY") ||
      path.join(projectRoot, "api", "public", "firmware"),
    boardFqbn: getOptionalEnv("FIRMWARE_BOARD_FQBN") || "esp8266:esp8266:d1_mini_lite",
  },
  mysql: {
    host: getRequiredEnv("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT || 3306),
    database: getRequiredEnv("MYSQL_DATABASE"),
    user: getRequiredEnv("MYSQL_USER"),
    password: process.env.MYSQL_PASSWORD || "",
    sslEnabled: parseBooleanEnv(process.env.MYSQL_SSL_ENABLED, false),
    sslRejectUnauthorized: parseBooleanEnv(process.env.MYSQL_SSL_REJECT_UNAUTHORIZED, true),
    sslCa: readOptionalSslCa(),
  },
};

module.exports = { config };

function parseBooleanEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean environment variable value: ${value}`);
}

function readOptionalSslCa() {
  const inlineCa = normalizeOptionalMultiline(process.env.MYSQL_SSL_CA);
  if (inlineCa) {
    return inlineCa;
  }

  const caPath = process.env.MYSQL_SSL_CA_PATH?.trim();
  if (!caPath) {
    return null;
  }

  return fs.readFileSync(caPath, "utf8");
}

function normalizeOptionalMultiline(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/\\n/g, "\n");
}
