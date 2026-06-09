const path = require("path");

function buildFirmwareBuildPlan(config, options) {
  const device = options.device;
  const version = String(options.version || "").trim();
  const channel = String(options.channel || "stable").trim() || "stable";
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const sketchPath = resolveSketchPath(config, options.sketchPath);
  const releaseCode = buildReleaseCode(device, version, channel);
  const binaryFilename = buildBinaryFilename(device, version, channel);
  const outputDirectory = path.resolve(options.outputDirectory || config.firmwareBuild.outputDirectory);
  const binaryPath = path.join(outputDirectory, binaryFilename);
  const firmwareUrl = normalizeFirmwareUrl(options.firmwareUrl || `/firmware/${binaryFilename}`);
  const secretsPath = path.join(path.dirname(sketchPath), "secrets.h");
  const deviceKeyPlaceholder =
    options.deviceApiKeyPlaceholder ||
    (device.device_api_key_last4
      ? `COLE_AQUI_A_CHAVE_QUE_TERMINA_COM_${device.device_api_key_last4}`
      : "COLE_AQUI_A_CHAVE_DO_ESP");

  const releaseNotes = options.notes || `Build individual do ESP ${device.device_id}.`;
  const secretsTemplate = buildSecretsHeader({
    wifiSsid: options.wifiSsid || "SEU_WIFI",
    wifiPassword: options.wifiPassword || "SUA_SENHA_WIFI",
    apiBaseUrl,
    deviceId: device.device_id,
    deviceApiKey: deviceKeyPlaceholder,
    allowInsecureTls: Boolean(options.allowInsecureTls),
    rootCa: options.rootCa || null,
  });

  const powerShellBuildCommand = buildPowerShellCommand([
    "node",
    "scripts/build-firmware.js",
    "--device-id",
    device.device_id,
    "--version",
    version,
    "--channel",
    channel,
    "--api-base-url",
    apiBaseUrl,
    "--device-key",
    deviceKeyPlaceholder,
    "--wifi-ssid",
    "SEU_WIFI",
    "--wifi-password",
    "SUA_SENHA_WIFI",
    "--root-ca-file",
    "C:\\caminho\\api-root-ca.pem",
    "--build",
  ]);

  return {
    target: {
      device_id: device.device_id,
      device_name: device.name,
      owner_user_id: device.owner_user_id || null,
      owner_company_name: device.owner_company_name || null,
      hardware_model: device.hardware_model || "lolin_d1_mini",
      firmware_profile: device.firmware_profile || device.device_id,
      expected_device_key_last4: device.device_api_key_last4 || null,
    },
    release: {
      version,
      channel,
      release_code: releaseCode,
      target_type: "device",
      target_device_id: device.device_id,
      hardware_model: device.hardware_model || "lolin_d1_mini",
      binary_filename: binaryFilename,
      sketch_path: sketchPath,
      firmware_url: firmwareUrl,
      notes: releaseNotes,
    },
    files: {
      sketch_path: sketchPath,
      secrets_path: secretsPath,
      output_directory: outputDirectory,
      binary_filename: binaryFilename,
      binary_path: binaryPath,
      firmware_url: firmwareUrl,
    },
    build: {
      board_fqbn: options.boardFqbn || config.firmwareBuild.boardFqbn,
      api_base_url: apiBaseUrl,
      allow_insecure_tls: Boolean(options.allowInsecureTls),
      working_directory: path.dirname(config.firmwareBuild.outputDirectory),
      powerShell_command: powerShellBuildCommand,
    },
    secrets_template: secretsTemplate,
    checklist: [
      "Confirme se a chave do ESP termina com os 4 digitos esperados antes de compilar.",
      "Gere o .bin localmente e salve-o em api/public/firmware para a OTA baixar esse arquivo.",
      "Depois da compilacao, cadastre a release usando o release_code sugerido para manter o rastreio.",
    ],
  };
}

function buildSecretsHeader(options) {
  const rootCaBlock = options.rootCa
    ? normalizeMultiline(options.rootCa)
    : [
        "-----BEGIN CERTIFICATE-----",
        "COLE_AQUI_A_RAIZ_CA_DA_SUA_API",
        "-----END CERTIFICATE-----",
      ].join("\n");

  return [
    "// Arquivo gerado para build individual do firmware.",
    `static const char* WIFI_SSID = ${toCppString(options.wifiSsid)};`,
    `static const char* WIFI_PASSWORD = ${toCppString(options.wifiPassword)};`,
    `static const char* API_BASE_URL = ${toCppString(options.apiBaseUrl)};`,
    `static const char* DEVICE_API_KEY = ${toCppString(options.deviceApiKey)};`,
    `static const char* DEVICE_ID = ${toCppString(options.deviceId)};`,
    `static const bool DEVICE_ALLOW_INSECURE_TLS = ${options.allowInsecureTls ? "true" : "false"};`,
    "",
    "static const char* API_ROOT_CA = R\"EOF(",
    rootCaBlock,
    ")EOF\";",
    "",
  ].join("\n");
}

function buildReleaseCode(device, version, channel) {
  return [channel || "stable", device.firmware_profile || device.device_id, version]
    .map((part) => slugify(part, "-"))
    .filter(Boolean)
    .join("-")
    .slice(0, 80);
}

function buildBinaryFilename(device, version, channel) {
  const devicePart = slugify(device.device_id, "_");
  const channelPart = slugify(channel || "stable", "_");
  const versionPart = slugify(version, "_");
  return `${[devicePart, channelPart, versionPart].filter(Boolean).join("_")}.bin`;
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/g, "");
  return normalized || "https://sua-api.vercel.app";
}

function normalizeFirmwareUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return normalized.startsWith("/") ? normalized : normalized.replace(/\/{2,}/g, "/");
}

function resolveSketchPath(config, explicitSketchPath) {
  return path.resolve(explicitSketchPath || config.firmwareBuild.sketchPath);
}

function slugify(value, separator) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, separator)
    .replace(new RegExp(`\\${separator}+`, "g"), separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "");
}

function normalizeMultiline(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function toCppString(value) {
  return JSON.stringify(String(value || ""));
}

function buildPowerShellCommand(parts) {
  return parts.map(quotePowerShellArgument).join(" ");
}

function quotePowerShellArgument(value) {
  const normalized = String(value || "");
  if (!/[^\w./:\\-]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '`"')}"`;
}

module.exports = {
  buildBinaryFilename,
  buildFirmwareBuildPlan,
  buildReleaseCode,
  buildSecretsHeader,
};
