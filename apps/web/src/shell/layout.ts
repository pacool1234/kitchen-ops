// The page frame's small rules (#85): the breadcrumb, and the avatar's initials.

export interface Crumb {
  name: string;
  title: string;
}

/**
 * Where a page sits, top first: each page names its parent route, and the trail follows them
 * up. `lookup` gives a route's title and parent by name. Refuses a missing parent or a loop.
 */
export function breadcrumbTrail(
  name: string,
  lookup: (name: string) => { title?: string; parent?: string } | undefined,
): Crumb[] {
  const trail: Crumb[] = [];
  const seen = new Set<string>();
  for (let current: string | undefined = name; current;) {
    if (seen.has(current)) {
      throw new Error(`the breadcrumb of "${name}" loops at "${current}"`);
    }
    seen.add(current);
    const page = lookup(current);
    if (!page) {
      throw new Error(
        `the breadcrumb of "${name}" names a missing page "${current}"`,
      );
    }
    trail.unshift({ name: current, title: page.title ?? current });
    current = page.parent;
  }
  return trail;
}

/** The first letters of the first and last names, as capitals: "Local counter" is "LC". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = (word: string) => Array.from(word)[0]!.toLocaleUpperCase();
  return words.length === 1
    ? first(words[0]!)
    : first(words[0]!) + first(words.at(-1)!);
}
