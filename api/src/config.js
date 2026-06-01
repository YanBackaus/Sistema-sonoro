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
  },
};

module.exports = { config };
