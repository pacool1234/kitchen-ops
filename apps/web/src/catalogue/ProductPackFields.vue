<script setup lang="ts">
import { BASE_UNIT_FACTOR, endpoints, type Product } from "@kitchen-ops/shared";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { call } from "../api";
import UiCombobox from "../components/ui/UiCombobox.vue";
import UiNumberField from "../components/ui/UiNumberField.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import { useT } from "../i18n";
import { SEARCH_DELAY_MS } from "./list-query";
import { usePackText } from "./pack-text";
import { packBaseUnits } from "./units";

// One of our products, found by typing (the API searches), and a pack in one of its units, with
// its live example (#89): what a supplier product is, in the catalogue's dialog and in review,
// where a document's line is remembered as one (#118). A product already chosen when it opens,
// the one being edited or the one a model suggested, is fetched for its units.
const productId = defineModel<string>("productId", { required: true });
const pack = defineModel<{ quantity: string; unit: string }>("pack", {
  required: true,
});
const props = defineProps<{
  errors: { productId?: string; quantity?: string; unit?: string };
  /** The chosen product's name, before it's been fetched. */
  selectedName?: string;
}>();
const emit = defineEmits<{
  touch: [field: "productId" | "pack.quantity" | "pack.unit"];
}>();
const t = useT();
const packText = usePackText();

/** Products seen, by ID: the picker's matches, and the one chosen when it opened. */
const known = ref(new Map<string, Product>());
const matches = ref<Product[]>([]);
const chosen = computed(() => known.value.get(productId.value));

let timer: ReturnType<typeof setTimeout> | undefined;
let asked = 0;
function search(text: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const mine = ++asked;
    try {
      const page = await call(endpoints.listProducts, {
        query: { q: text.trim() || undefined, pageSize: 20 },
      });
      if (mine !== asked) return;
      matches.value = page.items;
      for (const p of page.items) known.value.set(p.id, p);
    } catch {
      // The picker shows no matches; typing again tries again.
    }
  }, SEARCH_DELAY_MS);
}
onUnmounted(() => clearTimeout(timer));

onMounted(async () => {
  search("");
  const id = productId.value;
  if (id && !known.value.has(id)) {
    try {
      const product = await call(endpoints.getProduct, { params: { id } });
      known.value.set(product.id, product);
    } catch {
      // Its units can't be offered; the rest of the form still works.
    }
  }
});

const productOptions = computed(() =>
  matches.value.map((p) => ({ value: p.id, label: p.name })),
);
const productLabel = computed(
  () => chosen.value?.name ?? props.selectedName ?? "",
);
/** The chosen product's units: its base unit, then its purchase units. */
const units = computed(() => {
  const p = chosen.value;
  if (!p) return [];
  return [
    {
      value: p.baseUnit,
      label: t(`unitsShort.${p.baseUnit}`),
      factor: BASE_UNIT_FACTOR[p.baseUnit],
    },
    ...p.conversions.map((c) => ({
      value: c.unit,
      label: c.unit,
      factor: c.factor,
    })),
  ];
});
// Another product: a unit it doesn't have is cleared.
watch(units, (list) => {
  if (list.length > 0 && !list.some((u) => u.value === pack.value.unit)) {
    pack.value.unit = "";
  }
});
const example = computed(() => {
  const unit = units.value.find((u) => u.value === pack.value.unit);
  const p = chosen.value;
  if (!unit || !p || !pack.value.quantity) return undefined;
  return packText(
    pack.value,
    p.baseUnit,
    packBaseUnits(pack.value.quantity, unit.factor),
  );
});
</script>

<template>
  <UiCombobox
    v-model="productId"
    :label="t('supplierProducts.product')"
    :hint="t('supplierProducts.productHint')"
    :error="errors.productId"
    :options="productOptions"
    :selected-label="productLabel"
    remote
    @search="search"
    @update:model-value="emit('touch', 'productId')"
  />
  <fieldset class="flex flex-col gap-2">
    <legend class="mb-2 font-medium">
      {{ t("supplierProducts.pack") }}
    </legend>
    <div class="grid gap-4 sm:grid-cols-2">
      <UiNumberField
        v-model="pack.quantity"
        :label="t('supplierProducts.quantity')"
        :max-decimals="6"
        :error="errors.quantity"
        @blur="emit('touch', 'pack.quantity')"
      />
      <UiSelect
        v-model="pack.unit"
        :options="units"
        :label="t('supplierProducts.packUnit')"
        :placeholder="chosen ? undefined : t('supplierProducts.packUnitFirst')"
        :disabled="!chosen"
        :error="errors.unit"
        @update:model-value="emit('touch', 'pack.unit')"
      />
    </div>
    <p
      v-if="example"
      class="text-sm font-medium text-fg-muted tabular"
      aria-live="polite"
    >
      {{ example }}
    </p>
  </fieldset>
</template>
