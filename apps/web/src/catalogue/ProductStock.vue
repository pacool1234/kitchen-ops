<script setup lang="ts">
import {
  endpoints,
  Locale,
  type Product,
  type StoreroomStock,
} from "@kitchen-ops/shared";
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { call } from "../api";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import { useT } from "../i18n";
import { formatQuantity, formatUnitCost } from "../i18n/format";

// A product's stock and average cost in each storeroom it has moved through, on its page, for
// office and the owner (#120): where an invoice's correction shows. M8 adds its value and the
// movements behind it.
const props = defineProps<{ product: Product }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const headingId = useId();
/** Every storeroom at once: a restaurant has a few. */
const LIMIT = 200;

const rows = ref<StoreroomStock[]>([]);
const loading = ref(true);
const failed = ref(false);
async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const answer = await call(endpoints.getProductStock, {
      params: { id: props.product.id },
    });
    rows.value = answer.storerooms;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
watch(() => props.product.id, load, { immediate: true });

const onHand = (s: StoreroomStock) =>
  formatQuantity(s.onHand, props.product.baseUnit, language.value);
const cost = (s: StoreroomStock) =>
  formatUnitCost(s.averageCost, props.product.baseUnit, language.value);
const columns = computed<Column<StoreroomStock>[]>(() => [
  {
    key: "storeroom",
    label: t("products.stock.storeroom"),
    value: (s) => s.storeroom.name,
  },
  { key: "onHand", label: t("products.stock.onHand"), value: onHand },
  { key: "averageCost", label: t("products.stock.averageCost"), value: cost },
]);
</script>

<template>
  <section :aria-labelledby="headingId" class="flex flex-col gap-3">
    <h2 :id="headingId" class="text-xl font-semibold">
      {{ t("products.stock.heading") }}
    </h2>
    <UiDataTable
      :caption="t('products.stock.caption')"
      :columns="columns"
      :rows="rows"
      :row-key="(s) => s.storeroom.id"
      :total="rows.length"
      :page-size="LIMIT"
      :loading="loading"
      :error="failed ? t('products.stock.loadFailed') : undefined"
      :empty-title="t('products.stock.none')"
      @retry="load"
    >
      <template #cell-onHand="{ row }">
        <span class="tabular whitespace-nowrap">{{ onHand(row) }}</span>
      </template>
      <template #cell-averageCost="{ row }">
        <span class="tabular whitespace-nowrap">{{ cost(row) }}</span>
      </template>
      <template #card="{ row }">
        <div class="flex flex-col gap-1">
          <span class="font-semibold">{{ row.storeroom.name }}</span>
          <span class="text-sm tabular">
            {{ t("products.stock.onHand") }}: {{ onHand(row) }} ·
            {{ t("products.stock.averageCost") }}: {{ cost(row) }}
          </span>
        </div>
      </template>
    </UiDataTable>
  </section>
</template>
