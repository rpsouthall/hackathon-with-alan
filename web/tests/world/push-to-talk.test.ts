import test from "node:test";
import assert from "node:assert/strict";
import { bindPushToTalk } from "../../lib/voice/push-to-talk";
function fixture() {
  const windowTarget = Object.assign(new EventTarget(), { closest: () => null as unknown });
  const documentTarget = Object.assign(new EventTarget(), { hidden: false });
  let talking = false;
  const input = bindPushToTalk(windowTarget, documentTarget, (held) => { talking = held; });
  const key = (type: string, options: Record<string, unknown> = {}) => windowTarget.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code: "KeyT", ...options }));
  return { windowTarget, documentTarget, input, key, talking: () => talking };
}
test("T transmits only while held and keyup releases even with modifiers", () => {
  const f = fixture(); f.key("keydown"); assert.equal(f.talking(), true);
  f.key("keyup", { ctrlKey: true }); assert.equal(f.talking(), false); f.input.dispose();
});
test("typing, repeats, composition, modifiers and other shortcuts never activate", () => {
  const f = fixture();
  for (const options of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { code: "KeyV" }]) {
    f.key("keydown", options); assert.equal(f.talking(), false);
  }
  f.windowTarget.closest = () => ({}); f.key("keydown"); assert.equal(f.talking(), false); f.input.dispose();
});
test("blur, hidden page and disposal release every held source", () => {
  const f = fixture(); f.key("keydown"); f.input.setHeld("pointer", true);
  f.windowTarget.dispatchEvent(new Event("blur")); assert.equal(f.talking(), false);
  f.input.setHeld("pointer", true); f.documentTarget.hidden = true;
  f.documentTarget.dispatchEvent(new Event("visibilitychange")); assert.equal(f.talking(), false);
  f.input.setHeld("button-key", true); f.input.dispose(); assert.equal(f.talking(), false);
  f.key("keydown"); assert.equal(f.talking(), false);
});
test("releasing pointer does not silence a separately held shortcut", () => {
  const f = fixture(); f.key("keydown"); f.input.setHeld("pointer", true); f.input.setHeld("pointer", false);
  assert.equal(f.talking(), true); f.key("keyup"); assert.equal(f.talking(), false); f.input.dispose();
});
