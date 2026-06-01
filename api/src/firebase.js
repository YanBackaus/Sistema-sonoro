const fs = require("node:fs");
const admin = require("firebase-admin");

function createFirebaseSync(firebaseConfig) {
  const serviceAccount = JSON.parse(
    fs.readFileSync(firebaseConfig.serviceAccountPath, "utf8")
  );

  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: firebaseConfig.databaseURL,
      });

  const database = admin.database(app);

  async function syncReading(reading) {
    const root = firebaseConfig.deviceRoot.replace(/^\/+|\/+$/g, "");
    const devicePath = `${root}/${encodeKey(reading.device_id)}`;
    const historyKey = makeHistoryKey(reading.recorded_at);

    const payload = {
      device_id: reading.device_id,
      temperature: reading.temperature,
      humidity: reading.humidity,
      display_message: reading.display_message,
      wifi_rssi: reading.wifi_rssi,
      recorded_at: reading.recorded_at,
      mysql_id: reading.id,
    };

    await database.ref(`${devicePath}/live`).set(payload);
    await database.ref(`${devicePath}/history/${historyKey}`).set({
      ...payload,
      saved_at: new Date().toISOString(),
    });
  }

  return { syncReading };
}

function makeHistoryKey(recordedAt) {
  return String(recordedAt).replace(/[^A-Za-z0-9_-]/g, "_") || "unknown";
}

function encodeKey(value) {
  return String(value).replace(/[.#$/[\]]/g, "_");
}

module.exports = { createFirebaseSync };
