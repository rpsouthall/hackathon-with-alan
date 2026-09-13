import test from "node:test";
import assert from "node:assert/strict";
import { hostedJoinSchema, signWorldTicket, verifyWorldTicket, worldSocketUrl, type WorldTicket } from "../../lib/world/hosted-ticket";

const secret = "local-test-secret-not-for-production-123456789";
const origin = "https://kyoto.example";
const ticket = (now = Date.now()): WorldTicket => ({ name: "葵", roomId: "kyoto", playerId: crypto.randomUUID(), nonce: crypto.randomUUID(), origin, expiresAt: now + 60_000 });

test("only authentic unexpired tickets for this exact Site admit a player", async () => {
  const now = Date.now(), claims = ticket(now), token = await signWorldTicket(claims, secret);
  assert.deepEqual(await verifyWorldTicket(token, secret, origin, now), claims);
  assert.equal(await verifyWorldTicket(token, secret, "https://other.example", now), null);
  assert.equal(await verifyWorldTicket(token, secret + "wrong", origin, now), null);
  assert.equal(await verifyWorldTicket(token, secret, origin, now + 60_001), null);
  assert.equal(await verifyWorldTicket(token + ".extra", secret, origin, now), null);
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...claims, roomId: "other" })).toString("base64url");
  assert.notEqual(forged, body);
  assert.equal(await verifyWorldTicket(`${forged}.${signature}`, secret, origin, now), null);
});

test("tickets cannot be issued with missing secrets or accepted far into the future", async () => {
  await assert.rejects(signWorldTicket(ticket(), ""), /secret/);
  const now = Date.now();
  const token = await signWorldTicket({ ...ticket(now), expiresAt: now + 600_000 }, secret);
  assert.equal(await verifyWorldTicket(token, secret, origin, now), null);
});

test("friends using differently capitalized room codes join one room", () => {
  assert.deepEqual(hostedJoinSchema.parse({ name: " 葵 ", roomId: " KYOTO-Friends " }), { name: "葵", roomId: "kyoto-friends" });
  for (const roomId of ["../other", "", "a".repeat(49), "a/b"]) assert.equal(hostedJoinSchema.safeParse({ name: "A", roomId }).success, false);
  assert.equal(hostedJoinSchema.safeParse({ name: "A\u0000B", roomId: "kyoto" }).success, false);
});

test("hosted connections use secure WebSockets and do not leak credentials in addresses", () => {
  assert.equal(worldSocketUrl("https://world.example"), "wss://world.example/world");
  assert.equal(worldSocketUrl("http://127.0.0.1:8787"), "ws://127.0.0.1:8787/world");
  for (const value of ["http://world.example", "https://name:secret@world.example", "https://world.example?token=secret", "javascript:alert(1)"]) assert.throws(() => worldSocketUrl(value));
});
