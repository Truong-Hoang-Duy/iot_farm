#!/usr/bin/env node
// Chạy backend FastAPI bằng Python trong backend/.venv (Windows/macOS/Linux).
// Nếu chưa có venv thì dùng python/python3 trên PATH.
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
  const r = spawnSync(c, ["--version"], { stdio: "ignore", shell: false });
  if (r.status === 0) { py = c; break; }
}
if (!py) {
  console.error("Không tìm thấy Python. Hãy tạo venv: cd backend && py -3.12 -m venv .venv && .venv\\Scripts\\pip install -r requirements.txt");
  process.exit(1);
}
const port = process.env.PORT || "8000";
const args = ["-m", "uvicorn", "app.main:app", "--reload", "--reload-dir", "app", "--port", port];
console.log(`[backend] ${py} ${args.join(" ")}`);
const child = spawn(py, args, { cwd: backendDir, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));

