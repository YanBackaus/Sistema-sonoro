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

  return timingSafeEqualText(String(storedHash), hashDeviceApiKey(candidate, pepper));
}

function timingSafeEqualText(left, right) {
  if (!left || !right) {
    return false;
  }

  const expected = Buffer.from(String(left), "utf8");
  const actual = Buffer.from(String(right), "utf8");

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

function createSignedSessionToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signSessionBody(body, secret);
  return `${body}.${signature}`;
}

function verifySignedSessionToken(token, secret) {
  const normalized = String(token || "").trim();
  const separator = normalized.lastIndexOf(".");

  if (separator <= 0) {
    return null;
  }

  const body = normalized.slice(0, separator);
  const signature = normalized.slice(separator + 1);
  const expectedSignature = signSessionBody(body, secret);

  if (!timingSafeEqualText(signature, expectedSignature)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
}

function signSessionBody(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

module.exports = {
  createSignedSessionToken,
  generateDeviceApiKey,
  getKeyLast4,
  hashDeviceApiKey,
  timingSafeEqualText,
  verifyDeviceApiKey,
  verifySignedSessionToken,
};
