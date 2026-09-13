import { env } from "cloudflare:workers";
import { hostedJoinSchema, signWorldTicket, worldSocketUrl } from "@/lib/world/hosted-ticket";
import { readJoinBody } from "@/lib/world/join-body";

export const dynamic = "force-dynamic";
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The Site issues short-lived tickets; the room server never receives Site credentials. */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Open the game to join a room." }, 403);
  const runtime = env as unknown as { WORLD_SERVER_URL?: string; WORLD_TICKET_SECRET?: string };
  if (!runtime.WORLD_SERVER_URL || !runtime.WORLD_TICKET_SECRET) return reply({ error: "The shared world is being connected. You can explore solo while it is prepared." }, 503);
  try {
    const body = await readJoinBody(request);
    if (body === null) return reply({ error: "Join request is too large." }, 413);
    const parsed = hostedJoinSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return reply({ error: "Choose a name and a room using letters, numbers, dashes or underscores." }, 400);
    const url = worldSocketUrl(runtime.WORLD_SERVER_URL);
    const ticket = await signWorldTicket({ ...parsed.data, playerId: crypto.randomUUID(), nonce: crypto.randomUUID(), origin, expiresAt: Date.now() + 60_000 }, runtime.WORLD_TICKET_SECRET);
    return reply({ url, ticket });
  } catch { return reply({ error: "The room could not be opened. Please try again." }, 400); }
}
