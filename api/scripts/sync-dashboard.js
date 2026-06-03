const fs = require("fs");
const path = require("path");

const sourceDirectory = path.resolve(__dirname, "../../dashboard");
const targetDirectory = path.resolve(__dirname, "../public/admin");

fs.mkdirSync(targetDirectory, { recursive: true });
copyRecursive(sourceDirectory, targetDirectory);
rewriteAdminEntry();

console.log(`Dashboard sincronizado em ${targetDirectory}`);

function copyRecursive(sourcePath, targetPath) {
  const entries = fs.readdirSync(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    const entrySourcePath = path.join(sourcePath, entry.name);
    const entryTargetPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(entryTargetPath, { recursive: true });
      copyRecursive(entrySourcePath, entryTargetPath);
      continue;
    }

    fs.copyFileSync(entrySourcePath, entryTargetPath);
  }
}

function rewriteAdminEntry() {
  const adminIndexPath = path.join(targetDirectory, "index.html");
  const current = fs.readFileSync(adminIndexPath, "utf-8");
  const updated = current
    .replace('href="styles.css"', 'href="/admin/styles.css"')
    .replace('src="app.js"', 'src="/admin/app.js"');

  fs.writeFileSync(adminIndexPath, updated, "utf-8");
}
