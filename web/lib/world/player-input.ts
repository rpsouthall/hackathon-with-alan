const movementKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"]);
export type InputKey = Pick<KeyboardEvent, "key" | "code" | "repeat" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "target" | "preventDefault">;

/** Input belongs to the focused world. A modal, blur or hidden tab releases every hold. */
export class PlayerInput {
  private keys = new Set<string>();
  private shifts = new Set<string>();
  get sprinting(): boolean { return this.shifts.size > 0; }
  get direction(): [number, number] {
    return [Number(this.keys.has("d") || this.keys.has("arrowright")) - Number(this.keys.has("a") || this.keys.has("arrowleft")),
      Number(this.keys.has("s") || this.keys.has("arrowdown")) - Number(this.keys.has("w") || this.keys.has("arrowup"))];
  }
  clear(): void { this.keys.clear(); this.shifts.clear(); }
  keyDown(event: InputKey): "view" | "emotes" | "interact" | "vehicle" | undefined {
    const editing = (event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
    if (editing || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key === "shift") { this.shifts.add(event.code || "Shift"); return; }
    if (movementKeys.has(key)) { event.preventDefault(); this.keys.add(key); return; }
    if (event.repeat) return;
    const action = key === "v" ? "view" : key === "g" ? "emotes" : key === "e" ? "interact" : key === "f" ? "vehicle" : undefined;
    if (action) event.preventDefault();
    return action;
  }
  keyUp(event: Pick<InputKey, "key" | "code">): void {
    this.keys.delete(event.key.toLowerCase());
    if (event.key.toLowerCase() === "shift") this.shifts.delete(event.code || "Shift");
  }
}
