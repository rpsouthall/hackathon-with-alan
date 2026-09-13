let fallback: string | undefined;

/** Stable across encounters/reloads in this tab; separate players stay separate. */
export function lessonClientId(): string {
  const key = 'kyoto-lesson-client';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && /^[a-zA-Z0-9_-]{1,80}$/.test(saved)) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return fallback ??= crypto.randomUUID();
  }
}
