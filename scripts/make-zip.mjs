import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const targetZip = "C:/Users/OM NAMAH SHIVAY/OneDrive/Desktop/gold-intelligence-project.zip";
const tempDir = path.join(process.env.TEMP || "C:/Temp", "xau_pkg_export");

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

const filesToCopy = [
  "src",
  "public",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "mini-services",
  "db",
  ".env",
  "README.md",
  "tests"
];

for (const f of filesToCopy) {
  if (fs.existsSync(f)) {
    fs.cpSync(f, path.join(tempDir, f), { recursive: true });
  }
}

// Remove any nested node_modules
const nestedNm = path.join(tempDir, "mini-services", "stream-service", "node_modules");
if (fs.existsSync(nestedNm)) {
  fs.rmSync(nestedNm, { recursive: true, force: true });
}

try {
  execSync(`tar -a -c -f "${targetZip}" -C "${tempDir}" .`);
  console.log("SUCCESS:", targetZip);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

