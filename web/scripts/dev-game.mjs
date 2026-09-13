import { spawn } from "node:child_process";

const port = process.env.GAME_PORT || "5173";
const worldPort = process.env.WORLD_PORT || "8788";
const url = `ws://127.0.0.1:${worldPort}/world`;
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
const services = [
  { name: "world", args: ["--import", "tsx", "lib/world/run-server.ts"], env: {
    WORLD_PORT: worldPort,
    WORLD_ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
  } },
  { name: "frontend", args: ["scripts/run-framework.mjs", "dev", "--port", port], env: { VITE_WORLD_SERVER_URL: url } },
];
for (const service of services) {
  const child = spawn(process.execPath, service.args, { stdio: "inherit", env: { ...process.env, ...service.env } });
  children.push(child);
  child.on("error", (error) => { console.error(`${service.name}: ${error.message}`); stop(1); });
  child.on("exit", (code) => { if (!stopping) stop(code ?? 1); });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log(`Komorebi game: http://localhost:${port} — shared rooms: ${url}`);
