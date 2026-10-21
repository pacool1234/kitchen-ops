<script setup lang="ts">
import { endpoints, type Product } from "@kitchen-ops/shared";
import { Trash2 } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { call } from "../api";
import { SEARCH_DELAY_MS } from "../catalogue/list-query";
import UiButton from "../components/ui/UiButton.vue";
import UiCombobox from "../components/ui/UiCombobox.vue";
import UiNumberField from "../components/ui/UiNumberField.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import { useT } from "../i18n";
import { KITCHEN_UNIT, unitChoices, type LineValues } from "./record-form";

// One line of waste or a transfer (#151): a product found by typing (the API searches), and a
// quantity in kilos, litres or units, or in one of its purchase units. The product chosen goes up
// to the form, which needs its units to send the line.
const line = defineModel<LineValues>({ required: true });
const props = defineProps<{
  /** Its number, from 1. */
  n: number;
  errors: { productId?: string; quantity?: string; unit?: string };
  /** The chosen product, once the form knows it. */
  product: Product | undefined;
  /** The only line can't be removed: there's always one. */
  removable: boolean;
}>();
const emit = defineEmits<{
  chosen: [product: Product];
  touch: [field: "productId" | "quantity" | "unit"];
  remove: [];
}>();
const t = useT();

const matches = ref<Product[]>([]);
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
      if (mine === asked) matches.value = page.items;
    } catch {
      // The picker shows no matches; typing again tries again.
    }
  }, SEARCH_DELAY_MS);
}
onMounted(() => search(""));
onUnmounted(() => clearTimeout(timer));

const productOptions = computed(() =>
  matches.value.map((p) => ({ value: p.id, label: p.name })),
);
function choose(id: string | undefined) {
  const product = matches.value.find((p) => p.id === id);
  if (product) emit("chosen", product);
  emit("touch", "productId");
}

/** "kg", "l" or "ud." for the product's kitchen unit, then its purchase units by name. */
const units = computed(() => {
  const p = props.product;
  if (!p) return [];
  return unitChoices(p).map((u) => ({
    value: u.value,
    label:
      u.value !== KITCHEN_UNIT
        ? u.value
        : p.baseUnit === "g"
          ? "kg"
          : p.baseUnit === "ml"
            ? "l"
            : t("unitsShort.unit"),
  }));
});
// Another product: a unit it doesn't have becomes its kitchen unit.
watch(units, (list) => {
  if (list.length > 0 && !list.some((u) => u.value === line.value.unit)) {
    line.value.unit = KITCHEN_UNIT;
  }
});
/** Kilos and litres to the gram and millilitre; a purchase unit as the API takes it. */
const maxDecimals = computed(() => (line.value.unit === KITCHEN_UNIT ? 3 : 6));
</script>

<template>
  <fieldset class="flex flex-col gap-4 rounded-lg border border-line p-4">
    <legend class="px-1 font-medium">
      {{ t("stock.record.line", { n }) }}
    </legend>
    <UiCombobox
      v-model="line.productId"
      :label="t('stock.record.product')"
      :hint="t('stock.record.productHint')"
      :error="errors.productId"
      :options="productOptions"
      :selected-label="product?.name"
      remote
      @search="search"
      @update:model-value="choose"
    />
    <div class="grid grid-cols-2 gap-4">
      <UiNumberField
        v-model="line.quantity"
        :label="t('stock.record.quantity')"
        :max-decimals="maxDecimals"
        :error="errors.quantity"
        @blur="emit('touch', 'quantity')"
      />
      <UiSelect
        v-model="line.unit"
        :options="units"
        :label="t('stock.record.unit')"
        :placeholder="product ? undefined : t('stock.record.unitFirst')"
        :disabled="!product"
        :error="errors.unit"
        @update:model-value="emit('touch', 'unit')"
      />
    </div>
    <div v-if="removable">
      <UiButton
        variant="ghost"
        size="sm"
        :icon="Trash2"
        @click="emit('remove')"
      >
        {{ t("stock.record.removeLine", { n }) }}
      </UiButton>
    </div>
  </fieldset>
</template>
