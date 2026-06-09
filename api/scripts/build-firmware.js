#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { config } = require("../src/config");
const { createDatabasePool, getDeviceDetails } = require("../src/db");
const { buildFirmwareBuildPlan, buildSecretsHeader } = require("../src/firmware-build");

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.deviceId || !args.version) {
    printHelp("Informe pelo menos --device-id e --version.");
    process.exitCode = 1;
    return;
  }

  const pool = createDatabasePool(config.mysql);
  try {
    const device = await getDeviceDetails(pool, args.deviceId);
    if (!device) {
      throw new Error(`ESP ${args.deviceId} nao encontrado.`);
    }

    const rootCa = args.rootCaFile ? fs.readFileSync(path.resolve(args.rootCaFile), "utf8") : args.rootCaText || null;
    const plan = buildFirmwareBuildPlan(config, {
      device,
      version: args.version,
      channel: args.channel || "stable",
      apiBaseUrl: args.apiBaseUrl || "https://sua-api.vercel.app",
      firmwareUrl: args.firmwareUrl,
      outputDirectory: args.outputDirectory,
      sketchPath: args.sketchPath,
      boardFqbn: args.boardFqbn,
      deviceApiKeyPlaceholder: args.deviceKey || undefined,
      wifiSsid: args.wifiSsid || "SEU_WIFI",
      wifiPassword: args.wifiPassword || "SUA_SENHA_WIFI",
      rootCa,
      allowInsecureTls: args.allowInsecureTls,
    });

    if (args.writeSecrets) {
      fs.mkdirSync(path.dirname(path.resolve(args.writeSecrets)), { recursive: true });
      fs.writeFileSync(path.resolve(args.writeSecrets), plan.secrets_template, "utf8");
    }

    if (!args.build) {
      printPlan(plan, args.json);
      return;
    }

    ensureBuildInputs(args, rootCa);
    const buildResult = compileFirmware(plan, {
      deviceKey: args.deviceKey,
      wifiSsid: args.wifiSsid,
      wifiPassword: args.wifiPassword,
      rootCa,
      allowInsecureTls: args.allowInsecureTls,
    });

    const payload = {
      ok: true,
      message: "Firmware compilado com sucesso.",
      device_id: plan.target.device_id,
      binary_path: buildResult.binaryPath,
      firmware_url: plan.files.firmware_url,
      release_code: plan.release.release_code,
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    console.log("Firmware compilado com sucesso.");
    console.log(`ESP: ${plan.target.device_id}`);
    console.log(`Arquivo: ${buildResult.binaryPath}`);
    console.log(`URL sugerida: ${plan.files.firmware_url}`);
    console.log(`Release code: ${plan.release.release_code}`);
  } finally {
    await pool.end();
  }
}

function compileFirmware(plan, options) {
  const sketchPath = plan.files.sketch_path;
  const sketchDirectory = path.dirname(sketchPath);
  const sketchFileName = path.basename(sketchPath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "d1mini-build-"));
  const tempSketchDirectory = path.join(tempRoot, path.basename(sketchDirectory));
  const tempOutputDirectory = path.join(tempRoot, "out");
  const finalBinaryPath = path.resolve(plan.files.binary_path);

  try {
    fs.cpSync(sketchDirectory, tempSketchDirectory, { recursive: true });

    const secretsPath = path.join(tempSketchDirectory, "secrets.h");
    const secretsFile = buildSecretsHeader({
      wifiSsid: options.wifiSsid,
      wifiPassword: options.wifiPassword,
      apiBaseUrl: plan.build.api_base_url,
      deviceId: plan.target.device_id,
      deviceApiKey: options.deviceKey,
      allowInsecureTls: Boolean(options.allowInsecureTls),
      rootCa: options.rootCa,
    });
    fs.writeFileSync(secretsPath, secretsFile, "utf8");
    fs.mkdirSync(tempOutputDirectory, { recursive: true });

    const compileCommand = [
      "compile",
      "--fqbn",
      plan.build.board_fqbn,
      "--output-dir",
      tempOutputDirectory,
      path.join(tempSketchDirectory, sketchFileName),
    ];

    const compileResult = spawnSync("arduino-cli", compileCommand, {
      stdio: "inherit",
      shell: false,
    });

    if (compileResult.error) {
      throw new Error(
        compileResult.error.code === "ENOENT"
          ? "arduino-cli nao encontrado. Instale o Arduino CLI ou rode apenas o plano com --help."
          : compileResult.error.message
      );
    }

    if (compileResult.status !== 0) {
      throw new Error("A compilacao do firmware falhou.");
    }

    const compiledBinaryPath = findPrimaryBinary(tempOutputDirectory);
    if (!compiledBinaryPath) {
      throw new Error("Nao encontrei o arquivo .bin gerado pelo arduino-cli.");
    }

    fs.mkdirSync(path.dirname(finalBinaryPath), { recursive: true });
    fs.copyFileSync(compiledBinaryPath, finalBinaryPath);

    return {
      binaryPath: finalBinaryPath,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function ensureBuildInputs(args, rootCa) {
  if (!args.deviceKey) {
    throw new Error("Para compilar, informe --device-key com a chave atual do ESP.");
  }

  if (!args.wifiSsid || !args.wifiPassword) {
    throw new Error("Para compilar, informe --wifi-ssid e --wifi-password.");
  }

  if (!args.allowInsecureTls && !rootCa) {
    throw new Error("Informe --root-ca-file/--root-ca-text ou use --allow-insecure-tls apenas para teste.");
  }
}

function findPrimaryBinary(outputDirectory) {
  const candidates = fs
    .readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".bin"))
    .map((entry) => path.join(outputDirectory, entry.name));

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => fs.statSync(right).size - fs.statSync(left).size);
  return candidates[0];
}

function printPlan(plan, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  console.log("Plano de build");
  console.log(`ESP: ${plan.target.device_id}`);
  console.log(`Versao: ${plan.release.version}`);
  console.log(`Canal: ${plan.release.channel}`);
  console.log(`Release code: ${plan.release.release_code}`);
  console.log(`Binario: ${plan.files.binary_path}`);
  console.log(`Firmware URL: ${plan.files.firmware_url}`);
  console.log("");
  console.log("Comando sugerido:");
  console.log(plan.build.powerShell_command);
  console.log("");
  console.log("Template de secrets.h:");
  console.log(plan.secrets_template);
}

function parseArgs(argv) {
  const args = {
    allowInsecureTls: false,
    build: false,
    help: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    switch (token) {
      case "--device-id":
        args.deviceId = argv[++index];
        break;
      case "--version":
        args.version = argv[++index];
        break;
      case "--channel":
        args.channel = argv[++index];
        break;
      case "--api-base-url":
        args.apiBaseUrl = argv[++index];
        break;
      case "--device-key":
        args.deviceKey = argv[++index];
        break;
      case "--wifi-ssid":
        args.wifiSsid = argv[++index];
        break;
      case "--wifi-password":
        args.wifiPassword = argv[++index];
        break;
      case "--root-ca-file":
        args.rootCaFile = argv[++index];
        break;
      case "--root-ca-text":
        args.rootCaText = argv[++index];
        break;
      case "--output-directory":
        args.outputDirectory = argv[++index];
        break;
      case "--sketch-path":
        args.sketchPath = argv[++index];
        break;
      case "--board-fqbn":
        args.boardFqbn = argv[++index];
        break;
      case "--firmware-url":
        args.firmwareUrl = argv[++index];
        break;
      case "--write-secrets":
        args.writeSecrets = argv[++index];
        break;
      case "--allow-insecure-tls":
        args.allowInsecureTls = true;
        break;
      case "--build":
        args.build = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Argumento desconhecido: ${token}`);
    }
  }

  return args;
}

function printHelp(errorMessage) {
  if (errorMessage) {
    console.error(errorMessage);
    console.error("");
  }

  console.log("Uso:");
  console.log("  node scripts/build-firmware.js --device-id d1mini_01 --version 1.0.1 [opcoes]");
  console.log("");
  console.log("Opcoes:");
  console.log("  --channel stable");
  console.log("  --api-base-url https://sua-api.vercel.app");
  console.log("  --device-key CHAVE_DO_ESP");
  console.log("  --wifi-ssid SEU_WIFI");
  console.log("  --wifi-password SUA_SENHA");
  console.log("  --root-ca-file C:\\caminho\\api-root-ca.pem");
  console.log("  --allow-insecure-tls");
  console.log("  --write-secrets C:\\caminho\\secrets.h");
  console.log("  --build");
  console.log("  --json");
}
