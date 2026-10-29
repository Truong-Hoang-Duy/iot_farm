#!/usr/bin/env node
// Chạy một lệnh Python bằng interpreter trong backend/.venv (cwd hiện tại giữ nguyên).
// Ví dụ: node ../scripts/run-python.js -m scripts.seed_influx
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const backendDir = path.join(__dirname, "..", "backend");
const candidates = process.platform === "win32"
  ? [path.join(backendDir, ".venv", "Scripts", "python.exe"), "python", "py"]
  : [path.join(backendDir, ".venv", "bin", "python"), "python3", "python"];
let py = null;
for (const c of candidates) {
  if (c.includes(path.sep) && !fs.existsSync(c)) continue;
  if (spawnSync(c, ["--version"], { stdio: "ignore" }).status === 0) { py = c; break; }
}
if (!py) { console.error("Không tìm thấy Python"); process.exit(1); }
const child = spawn(py, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));

