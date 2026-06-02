const crypto = require("crypto");

function generateDeviceApiKey() {
  return `d1k_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashDeviceApiKey(deviceApiKey, pepper) {
  return crypto.createHmac("sha256", pepper).update(String(deviceApiKey)).digest("hex");
}

function getKeyLast4(value) {
  const normalized = String(value || "");
  return normalized.length >= 4 ? normalized.slice(-4) : normalized;
}

function verifyDeviceApiKey(candidate, storedHash, pepper) {
  if (!candidate || !storedHash) {
    return false;
  }

  const expected = Buffer.from(String(storedHash), "utf8");
  const actual = Buffer.from(hashDeviceApiKey(candidate, pepper), "utf8");

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  generateDeviceApiKey,
  hashDeviceApiKey,
  getKeyLast4,
  verifyDeviceApiKey,
};
