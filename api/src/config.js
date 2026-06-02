const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

const config = {
  port: Number(process.env.PORT || 3000),
  apiKey: getRequiredEnv("API_KEY"),
  defaultUtcOffsetMinutes: Number(process.env.DEFAULT_UTC_OFFSET_MINUTES || -180),
  defaultPollIntervalSeconds: Number(process.env.DEFAULT_POLL_INTERVAL_SECONDS || 60),
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
