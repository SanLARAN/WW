import { useEffect, useState } from 'preact/hooks';

/** Minimal external store — enough for a game HUD, no extra dependency. */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const l of listeners) l(value);
    },
    update(fn: (v: T) => T) {
      this.set(fn(value));
    },
    subscribe(l: (v: T) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  const [v, setV] = useState<T>(store.get());
  useEffect(() => store.subscribe(setV), [store]);
  return v;
}
