export interface ClosableSession { close(): Promise<void> }

/** Reserve one paid session, and finish teardown before reusing its slot. */
export class LiveSessionSlot<T extends ClosableSession> {
  private active?: { owner: string; value: T; closing?: Promise<void> };
  private queue: Promise<unknown> = Promise.resolve();

  open(owner: string, create: () => T, signal: AbortSignal): Promise<T> {
    const pending = this.queue.then(async () => {
      signal.throwIfAborted();
      const previous = this.active;
      if (previous) {
        if (previous.owner !== owner && !previous.closing) {
          throw new Error('Another player is using the live avatar. Please try again when their conversation ends.');
        }
        await this.close(previous.value);
      }
      signal.throwIfAborted();
      const value = create();
      this.active = { owner, value };
      return value;
    });
    this.queue = pending.catch(() => {});
    return pending;
  }

  close(value: T): Promise<void> {
    const current = this.active;
    if (!current || current.value !== value) return value.close();
    current.closing ??= Promise.resolve().then(() => value.close()).finally(() => {
      if (this.active === current) this.active = undefined;
    });
    return current.closing;
  }
}
