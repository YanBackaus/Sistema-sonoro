#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { config } = require("../src/config");

async function main() {
  const schemaPath = path.resolve(__dirname, "../../database/schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");

  const connection = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    database: config.mysql.database,
    user: config.mysql.user,
    password: config.mysql.password,
    multipleStatements: true,
    ssl: buildSslConfig(config.mysql),
  });

  try {
    await connection.query(schemaSql);
    console.log(`Schema aplicado com sucesso em ${config.mysql.database}.`);
  } finally {
    await connection.end();
  }
}

function buildSslConfig(mysqlConfig) {
  if (!mysqlConfig.sslEnabled) {
    return undefined;
  }

  const ssl = {
    minVersion: "TLSv1.2",
    rejectUnauthorized: mysqlConfig.sslRejectUnauthorized,
  };

  if (mysqlConfig.sslCa) {
    ssl.ca = mysqlConfig.sslCa;
  }

  return ssl;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
