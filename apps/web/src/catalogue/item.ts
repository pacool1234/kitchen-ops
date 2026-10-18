import { mayCall, type Endpoint } from "@kitchen-ops/shared";
import { computed, nextTick, ref, watch, type Ref } from "vue";
import { useRouter } from "vue-router";
import type { z } from "zod";
import { ApiError } from "../api";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import { currentUser } from "../session";
import { usePageTitle } from "../shell/title";
import { useForm } from "./form";
import { useUnsavedGuard } from "./unsaved";

// One catalogue item's page (#89, decision 0027): a new one's form, an existing one's form, or,
// for a role that can't change it, its details to read. It loads the item, saves it, and
// deactivates or reactivates it, with a notice for each.

export interface CatalogueItem {
  id: string;
  name: string;
  active: boolean;
}

export interface CatalogueItemOptions<
  Item extends CatalogueItem,
  S extends z.ZodType,
  V extends Record<string, unknown>,
> {
  /** The item's ID, from the route; undefined for a new one. */
  id: () => string | undefined;
  /** What may change it: the role check comes from the contract (mayCall). */
  update: Endpoint;
  schema: S;
  /** A new item's form. */
  empty: V;
  /** An item's form, from the item. */
  valuesOf: (item: Item) => V;
  load: (id: string) => Promise<Item>;
  create: (data: z.output<S>) => Promise<Item>;
  save: (id: string, data: z.output<S> | { active: boolean }) => Promise<Item>;
  /** The route of an item's page, to go to once a new one is created. */
  route: string;
  messages: {
    created: MessageKey;
    deactivated: MessageKey;
    reactivated: MessageKey;
  };
}

export function useCatalogueItem<
  Item extends CatalogueItem,
  S extends z.ZodType,
  V extends Record<string, unknown>,
>(options: CatalogueItemOptions<Item, S, V>) {
  const t = useT();
  const router = useRouter();
  const item = ref<Item>() as Ref<Item | undefined>;
  const loading = ref(false);
  const loadError = ref<MessageKey>();
  const working = ref(false);
  const confirming = ref(false);
  const canWrite = computed(() =>
    mayCall(options.update, currentUser.value?.role ?? null),
  );

  const form = useForm(options.schema, options.empty);
  const guard = useUnsavedGuard(form.dirty);
  usePageTitle(() => item.value?.name);

  function failed(caught: unknown) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  }

  async function load(id: string) {
    loading.value = true;
    loadError.value = undefined;
    try {
      item.value = await options.load(id);
      form.reset(options.valuesOf(item.value));
    } catch (caught) {
      loadError.value =
        caught instanceof ApiError && caught.status === 404
          ? "catalogue.notFound"
          : caught instanceof ApiError
            ? errorMessageKey(caught)
            : "catalogue.loadFailed";
    } finally {
      loading.value = false;
    }
  }
  watch(
    options.id,
    (id) => {
      if (id) {
        if (id !== item.value?.id) void load(id);
      } else {
        item.value = undefined;
        form.reset(options.empty);
      }
    },
    { immediate: true },
  );

  /** Checks the form and saves it: creates a new item, or saves an existing one's changes. */
  async function save() {
    try {
      const saved = await form.submit(async (data) => {
        const id = options.id();
        const result = id
          ? await options.save(id, data)
          : await options.create(data);
        item.value = result;
        form.reset(options.valuesOf(result));
        showToast({
          tone: "success",
          title: t(id ? "catalogue.saved" : options.messages.created),
        });
        if (!id) {
          await router.replace({
            name: options.route,
            params: { id: result.id },
          });
        }
      });
      if (!saved) {
        // Refused: the first field with an error takes focus, so it's read out.
        await nextTick();
        document
          .querySelector<HTMLElement>("main [aria-invalid='true']")
          ?.focus();
      }
    } catch (caught) {
      failed(caught);
    }
  }

  /** Deactivates or reactivates the item; whatever is typed in the form stays. */
  async function setActive(active: boolean) {
    const id = options.id();
    if (!id) return;
    working.value = true;
    try {
      item.value = await options.save(id, { active });
      showToast({
        tone: "success",
        title: t(
          active ? options.messages.reactivated : options.messages.deactivated,
        ),
      });
      confirming.value = false;
    } catch (caught) {
      failed(caught);
    } finally {
      working.value = false;
    }
  }

  return {
    item,
    loading,
    loadError,
    canWrite,
    working,
    confirming,
    form,
    guard,
    save,
    setActive,
  };
}
