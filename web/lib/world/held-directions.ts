export type HeldDirection = [number, number];
/** Independent contacts allow diagonal movement and releasing either thumb first. */
export class HeldDirections {
  private contacts = new Map<number | string, HeldDirection>();
  constructor(private changed: (direction: HeldDirection) => void) {}
  setOnChange(changed: (direction: HeldDirection) => void) { this.changed = changed; }
  hold(id: number | string, direction: HeldDirection) { this.contacts.set(id, direction); this.publish(); }
  release(id: number | string) { if (this.contacts.delete(id)) this.publish(); }
  clear() { this.contacts.clear(); this.changed([0, 0]); }
  private publish() {
    let x = 0, z = 0;
    for (const direction of this.contacts.values()) { x += direction[0]; z += direction[1]; }
    this.changed([Math.sign(x), Math.sign(z)]);
  }
}
