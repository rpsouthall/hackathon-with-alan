import { createRoomServer } from "./dev-server";

const server = createRoomServer({ origins: (process.env.WORLD_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",") });
const port = await server.listen(Number(process.env.WORLD_PORT ?? 8788));
console.log(`World demo server: ws://127.0.0.1:${port}/world (guest rooms, in-memory state)`);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, async () => { await server.close(); process.exit(0); });
