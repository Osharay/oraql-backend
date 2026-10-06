/** The first item for each key, in order: one row per bet, the earliest kept. */
export function firstOfEach<T>(items: T[], key: (i: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
