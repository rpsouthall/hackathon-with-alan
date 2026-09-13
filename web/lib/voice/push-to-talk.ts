/** Holds are explicit; losing focus always releases all transmission sources. */
export function bindPushToTalk(windowTarget: EventTarget, documentTarget: EventTarget & { hidden: boolean }, onTalking: (held: boolean) => void) {
  const held = new Set<string>();
  function setHeld(source: string, pressed: boolean) {
    if (pressed) held.add(source); else held.delete(source);
    onTalking(held.size > 0);
  }
  function releaseAll() { held.clear(); onTalking(false); }
  function editing(target: EventTarget | null) {
    return !!(target as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  }
  function keydown(event: Event) {
    const key = event as KeyboardEvent;
    if (key.code !== "KeyT" || key.repeat || key.ctrlKey || key.metaKey || key.altKey || key.shiftKey || key.isComposing || editing(key.target)) return;
    key.preventDefault(); setHeld("shortcut", true);
  }
  function keyup(event: Event) {
    if ((event as KeyboardEvent).code === "KeyT") setHeld("shortcut", false);
  }
  function visibility() { if (documentTarget.hidden) releaseAll(); }
  function focus(event: Event) { if (editing(event.target)) releaseAll(); }
  windowTarget.addEventListener("keydown", keydown);
  windowTarget.addEventListener("keyup", keyup);
  windowTarget.addEventListener("blur", releaseAll);
  documentTarget.addEventListener("visibilitychange", visibility);
  documentTarget.addEventListener("focusin", focus);
  return {
    setHeld, releaseAll,
    dispose() {
      windowTarget.removeEventListener("keydown", keydown);
      windowTarget.removeEventListener("keyup", keyup);
      windowTarget.removeEventListener("blur", releaseAll);
      documentTarget.removeEventListener("visibilitychange", visibility);
      documentTarget.removeEventListener("focusin", focus);
      releaseAll();
    },
  };
}
