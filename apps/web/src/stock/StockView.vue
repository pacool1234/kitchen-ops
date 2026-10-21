<script setup lang="ts">
import {
  endpoints,
  Locale,
  PRODUCT_CATEGORIES,
  seesCosts,
  type StockPlace,
  type Storeroom,
} from "@kitchen-ops/shared";
import { computed, onMounted, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowRightLeft, Trash2 } from "lucide-vue-next";
import { RouterLink } from "vue-router";
import { call } from "../api";
import { useCatalogueList } from "../catalogue/list-query";
import { buttonClasses } from "../components/ui/styles";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { useT } from "../i18n";
import { formatMoney, formatQuantity, formatUnitCost } from "../i18n/format";
import { currentUser } from "../session";

// Stock per storeroom (#150): every product in every storeroom it has moved through, searched as
// typed and filtered by storeroom and category, a page at a time from the API. Office and the
// owner also see its cost and value, and what the whole stock is worth. Cards on a phone, a
// table from 768px. Everyone records waste and transfers from here (#151).
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const totalsId = useId();

/** Rows per page: stock is scanned more than looked up, so longer pages than the catalogue's. */
const PAGE_SIZE = 50;
const {
  state,
  search,
  set,
  items,
  total,
  answer,
  loading,
  error,
  filtering,
  reload,
} = useCatalogueList(
  endpoints.listStock,
  ["storeroomId", "category"],
  "stock.loadFailed",
  { statuses: false, pageSize: PAGE_SIZE },
);
const costs = computed(() =>
  currentUser.value ? seesCosts(currentUser.value.role) : false,
);
const totals = computed(() => answer.value?.totals);

// The storerooms, for the filter: a few, so all at once, those no longer in use included.
const storerooms = ref<Storeroom[]>([]);
onMounted(async () => {
  try {
    storerooms.value = (
      await call(endpoints.listStorerooms, {
        query: { pageSize: 200, status: "all" },
      })
    ).items;
  } catch {
    // The filter offers "all" only; the list itself still works.
  }
});

// "" is no filter: Reka's select can't hold an empty value, so "all" stands for it.
const ALL = "all";
const storeroomOptions = computed(() => [
  { value: ALL, label: t("stock.allStorerooms") },
  ...storerooms.value.map((s) => ({ value: s.id, label: s.name })),
]);
const categories = computed(() => [
  { value: ALL, label: t("stock.allCategories") },
  ...PRODUCT_CATEGORIES.map((value) => ({
    value,
    label: t(`products.categories.${value}`),
  })),
]);
const filter = (name: string, value: string | undefined) =>
  set({ filters: { [name]: !value || value === ALL ? "" : value } });

const onHand = (p: StockPlace) =>
  formatQuantity(p.onHand, p.product.baseUnit, language.value);
const cost = (p: StockPlace) =>
  p.averageCost === undefined
    ? ""
    : formatUnitCost(p.averageCost, p.product.baseUnit, language.value);
const value = (p: StockPlace) =>
  p.value === undefined ? "" : formatMoney(p.value, language.value);
const columns = computed<Column<StockPlace>[]>(() => [
  { key: "product", label: t("stock.product"), value: (p) => p.product.name },
  {
    key: "storeroom",
    label: t("stock.storeroom"),
    value: (p) => p.storeroom.name,
  },
  { key: "onHand", label: t("stock.onHand"), value: onHand, align: "end" },
  ...(costs.value
    ? ([
        {
          key: "averageCost",
          label: t("stock.averageCost"),
          value: cost,
          align: "end",
        },
        { key: "value", label: t("stock.value"), value, align: "end" },
      ] as const)
    : []),
]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap gap-3">
      <RouterLink :to="{ name: 'new-waste' }" :class="buttonClasses()">
        <Trash2 class="size-4" aria-hidden="true" />
        {{ t("stock.newWaste") }}
      </RouterLink>
      <RouterLink
        :to="{ name: 'new-transfer' }"
        :class="buttonClasses('secondary')"
      >
        <ArrowRightLeft class="size-4" aria-hidden="true" />
        {{ t("stock.newTransfer") }}
      </RouterLink>
    </div>
    <section
      v-if="costs && totals"
      :aria-labelledby="totalsId"
      class="flex flex-col gap-2 rounded-lg border border-line p-4"
    >
      <h2 :id="totalsId" class="text-base font-semibold">
        {{ t("stock.totals") }}
      </h2>
      <dl class="flex flex-wrap gap-x-6 gap-y-2">
        <div
          v-for="room in totals.storerooms"
          :key="room.storeroom.id"
          class="flex flex-col"
        >
          <dt class="text-sm text-fg-muted">{{ room.storeroom.name }}</dt>
          <dd class="tabular">{{ formatMoney(room.value, language) }}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-sm text-fg-muted">{{ t("stock.total") }}</dt>
          <dd class="tabular font-semibold">
            {{ formatMoney(totals.value, language) }}
          </dd>
        </div>
      </dl>
    </section>

    <div class="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div class="lg:flex-1">
        <UiTextField
          v-model="search"
          type="search"
          :label="t('catalogue.search')"
          optional
          autocomplete="off"
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:flex">
        <div class="lg:w-48">
          <UiSelect
            :model-value="state.filters.storeroomId || ALL"
            :options="storeroomOptions"
            :label="t('stock.storeroom')"
            @update:model-value="(value) => filter('storeroomId', value)"
          />
        </div>
        <div class="lg:w-44">
          <UiSelect
            :model-value="state.filters.category || ALL"
            :options="categories"
            :label="t('stock.category')"
            @update:model-value="(value) => filter('category', value)"
          />
        </div>
      </div>
    </div>

    <UiDataTable
      :page="state.page"
      :caption="t('stock.caption')"
      :columns="columns"
      :rows="items"
      :row-key="(p) => `${p.product.id}:${p.storeroom.id}`"
      :total="total"
      :page-size="PAGE_SIZE"
      :loading="loading"
      :error="error && t(error)"
      :empty-title="filtering ? t('catalogue.noMatches') : t('stock.empty')"
      :empty-description="
        filtering
          ? t('catalogue.noMatchesDescription')
          : t('stock.emptyDescription')
      "
      @update:page="(page) => set({ page })"
      @retry="reload"
    >
      <template #cell-product="{ row }">
        <RouterLink
          :to="{ name: 'stock-product', params: { id: row.product.id } }"
          class="font-medium text-primary underline-offset-4 hover:underline"
        >
          {{ row.product.name }}
        </RouterLink>
      </template>
      <template #cell-onHand="{ row }">
        <span class="tabular whitespace-nowrap">{{ onHand(row) }}</span>
      </template>
      <template #cell-averageCost="{ row }">
        <span class="tabular whitespace-nowrap">{{ cost(row) }}</span>
      </template>
      <template #cell-value="{ row }">
        <span class="tabular whitespace-nowrap">{{ value(row) }}</span>
      </template>
      <template #card="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <RouterLink
              :to="{ name: 'stock-product', params: { id: row.product.id } }"
              class="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {{ row.product.name }}
            </RouterLink>
            <span class="text-sm text-fg-muted">
              {{ row.storeroom.name }}
              <template v-if="costs"> · {{ cost(row) }}</template>
            </span>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="tabular whitespace-nowrap font-medium">
              {{ onHand(row) }}
            </span>
            <span v-if="costs" class="tabular whitespace-nowrap text-sm">
              {{ value(row) }}
            </span>
          </div>
        </div>
      </template>
    </UiDataTable>
  </div>
</template>
