import { onUnmounted, readonly, ref, watchEffect } from "vue";

// A page's own title (#89): a supplier's page is titled with its name, not "Proveedor". The
// frame shows it as the h1, the breadcrumb's last step and the browser tab's title. Pages
// without one keep their route's title.

const own = ref<{ text: string; owner: symbol } | null>(null);

/** The title the page showing now gave itself, if any. */
export const ownTitle = readonly(own);

/** Titles the page with `title()`, while it's mounted. Undefined: the route's own title. */
export function usePageTitle(title: () => string | undefined): void {
  const owner = Symbol("page title");
  watchEffect(() => {
    const text = title();
    if (text) own.value = { text, owner };
    else if (own.value?.owner === owner) own.value = null;
  });
  // Only its own: the next page may already have set one.
  onUnmounted(() => {
    if (own.value?.owner === owner) own.value = null;
  });
}
