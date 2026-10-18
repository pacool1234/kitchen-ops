import {
  LIST_STATUSES,
  type Endpoint,
  type ListStatus,
} from "@kitchen-ops/shared";
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import {
  useRoute,
  useRouter,
  type LocationQuery,
  type LocationQueryRaw,
} from "vue-router";
import type { z } from "zod";
import { ApiError, call } from "../api";
import type { MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";

// A catalogue list (#89, decision 0027): its search, filters and page are in the URL, so the
// back button and a refresh keep them, and the API searches and pages. Typing waits for a
// pause before it searches, and a late answer never replaces a newer one.

/** How long typing must pause before the list searches. */
export const SEARCH_DELAY_MS = 250;

export interface ListState {
  q: string;
  status: ListStatus;
  page: number;
  /** The list's own filters, by name: "" for none. */
  filters: Record<string, string>;
}

const first = (value: LocationQuery[string] | undefined): string => {
  const text = Array.isArray(value) ? value[0] : value;
  return text ?? "";
};

/** A list's state from the URL's query. Anything it can't read is the default. */
export function readListQuery(
  query: LocationQuery,
  filterNames: readonly string[],
): ListState {
  const status = first(query.status);
  const page = Number(first(query.page));
  return {
    q: first(query.q),
    status: (LIST_STATUSES as readonly string[]).includes(status)
      ? (status as ListStatus)
      : "active",
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    filters: Object.fromEntries(
      filterNames.map((name) => [name, first(query[name])]),
    ),
  };
}

/** The URL's query for a state: only what isn't the default. */
export function writeListQuery(state: ListState): LocationQueryRaw {
  const query: LocationQueryRaw = {};
  if (state.q) query.q = state.q;
  if (state.status !== "active") query.status = state.status;
  if (state.page !== 1) query.page = String(state.page);
  for (const [name, value] of Object.entries(state.filters)) {
    if (value) query[name] = value;
  }
  return query;
}

/** A change to a list: its search, status, page or some of its filters. */
export type ListChange = Partial<Omit<ListState, "filters">> & {
  filters?: Record<string, string>;
};

/**
 * The list after a change. A new search, status or filter goes back to page 1: page 3 of the
 * old results may not exist in the new ones. Only a change of page itself keeps it.
 */
export function changeList(state: ListState, change: ListChange): ListState {
  return {
    ...state,
    page: 1,
    ...change,
    filters: { ...state.filters, ...change.filters },
  };
}

export type Latest<T> = { stale: true } | { stale: false; value: T };

/**
 * Runs one request after another, and says which answers are stale: one that comes after a
 * newer request was made. A stale request's error is stale too.
 */
export function latestOnly() {
  let last = 0;
  return async function latest<T>(work: () => Promise<T>): Promise<Latest<T>> {
    const mine = ++last;
    try {
      const value = await work();
      return mine === last ? { stale: false, value } : { stale: true };
    } catch (error) {
      if (mine !== last) return { stale: true };
      throw error;
    }
  };
}

/** A page of any catalogue list, as the API answers it. */
interface Page<Item> {
  items: Item[];
  total: number;
}

/**
 * A catalogue list: the URL's state, the search as typed, and the page the API answered. Set a
 * filter or the page with `set`; each change goes back to page 1, except the page itself.
 */
export function useCatalogueList<
  E extends Endpoint & { response: z.ZodType<Page<unknown>> },
>(endpoint: E, filterNames: readonly string[], loadFailed: MessageKey) {
  type Item = z.output<E["response"]>["items"][number];
  const route = useRoute();
  const router = useRouter();
  const state = computed(() => readListQuery(route.query, filterNames));

  const items = shallowRef<Item[]>([]);
  const total = ref(0);
  const loading = ref(true);
  const error = ref<MessageKey>();
  const latest = latestOnly();

  function set(change: ListChange) {
    // Replaced, not pushed: the back button leaves the list, not each keystroke.
    void router.replace({
      query: writeListQuery(changeList(state.value, change)),
    });
  }

  // What's typed: it goes into the URL once typing pauses.
  const search = ref(state.value.q);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(search, (q) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (q.trim() !== state.value.q.trim()) set({ q });
    }, SEARCH_DELAY_MS);
  });
  onUnmounted(() => clearTimeout(timer));
  // The URL changed some other way (back, a link): the field follows it.
  watch(
    () => state.value.q,
    (q) => {
      if (q.trim() !== search.value.trim()) search.value = q;
    },
  );

  async function load() {
    const { q, status, page, filters } = state.value;
    loading.value = true;
    error.value = undefined;
    try {
      const answer = await latest(() =>
        call(
          endpoint as Endpoint,
          {
            query: {
              q: q.trim() || undefined,
              status,
              page,
              pageSize: PAGE_SIZE,
              ...Object.fromEntries(
                Object.entries(filters).map(([name, value]) => [
                  name,
                  value || undefined,
                ]),
              ),
            },
          } as never,
        ),
      );
      if (answer.stale) return;
      const { items: rows, total: count } = answer.value as Page<Item>;
      items.value = rows;
      total.value = count;
      loading.value = false;
    } catch (caught) {
      error.value =
        caught instanceof ApiError ? errorMessageKey(caught) : loadFailed;
      loading.value = false;
    }
  }
  watch(state, load, { immediate: true, deep: true });

  /** Whether a search or a filter is narrowing the list: then "nothing matches", not "none yet". */
  const filtering = computed(
    () =>
      state.value.q.trim() !== "" ||
      state.value.status !== "active" ||
      Object.values(state.value.filters).some(Boolean),
  );

  return {
    state,
    search,
    set,
    items,
    total,
    loading,
    error,
    filtering,
    reload: load,
  };
}

/** Rows per page in every catalogue list. */
export const PAGE_SIZE = 20;
