<script setup lang="ts">
import {
  endpoints,
  LIST_STATUSES,
  mayCall,
  PRODUCT_CATEGORIES,
  type ListStatus,
  type Product,
  type Storeroom,
} from "@kitchen-ops/shared";
import { Plus } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { call } from "../api";
import UiBadge from "../components/ui/UiBadge.vue";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { buttonClasses } from "../components/ui/styles";
import { useT } from "../i18n";
import { currentUser } from "../session";
import CatalogueTabs from "./CatalogueTabs.vue";
import { PAGE_SIZE, useCatalogueList } from "./list-query";

// The products (#89): searched as typed, filtered by category, usual storeroom and status, a page
// at a time from the API. Cards on a phone, a table from 768px.
const t = useT();
const { state, search, set, items, total, loading, error, filtering, reload } =
  useCatalogueList(
    endpoints.listProducts,
    ["category", "storeroomId"],
    "products.loadFailed",
  );
const canCreate = computed(() =>
  mayCall(endpoints.createProduct, currentUser.value?.role ?? null),
);

// The storerooms, for the filter and each row's: a few, so all at once.
const storerooms = ref<Storeroom[]>([]);
onMounted(async () => {
  try {
    storerooms.value = (
      await call(endpoints.listStorerooms, { query: { pageSize: 200 } })
    ).items;
  } catch {
    // The filter offers "all" only; the list itself still works.
  }
});
const storeroomName = (id: string | null) =>
  storerooms.value.find((s) => s.id === id)?.name ?? "";

// "" is no filter: Reka's select can't hold an empty value, so "all" stands for it.
const ALL = "all";
const categories = computed(() => [
  { value: ALL, label: t("products.allCategories") },
  ...PRODUCT_CATEGORIES.map((value) => ({
    value,
    label: t(`products.categories.${value}`),
  })),
]);
const storeroomOptions = computed(() => [
  { value: ALL, label: t("products.allStorerooms") },
  ...storerooms.value.map((s) => ({ value: s.id, label: s.name })),
]);
const statuses = computed(() =>
  LIST_STATUSES.map((value) => ({
    value,
    label: t(`catalogue.statuses.${value}`),
  })),
);
const filter = (name: string, value: string | undefined) =>
  set({ filters: { [name]: !value || value === ALL ? "" : value } });

const category = (p: Product) => t(`products.categories.${p.category}`);
const columns = computed<Column<Product>[]>(() => [
  { key: "name", label: t("products.name"), value: (p) => p.name },
  { key: "category", label: t("products.category"), value: category },
  {
    key: "baseUnit",
    label: t("products.baseUnit"),
    value: (p) => t(`units.${p.baseUnit}`),
  },
  {
    key: "storeroom",
    label: t("products.storeroom"),
    value: (p) => storeroomName(p.defaultStoreroomId),
  },
  {
    key: "active",
    label: t("catalogue.status"),
    value: (p) => t(p.active ? "catalogue.active" : "catalogue.inactive"),
  },
]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <CatalogueTabs />
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
      <div class="grid gap-3 sm:grid-cols-3 lg:flex">
        <div class="lg:w-44">
          <UiSelect
            :model-value="state.filters.category || ALL"
            :options="categories"
            :label="t('products.category')"
            @update:model-value="(value) => filter('category', value)"
          />
        </div>
        <div class="lg:w-48">
          <UiSelect
            :model-value="state.filters.storeroomId || ALL"
            :options="storeroomOptions"
            :label="t('products.storeroom')"
            @update:model-value="(value) => filter('storeroomId', value)"
          />
        </div>
        <div class="lg:w-36">
          <UiSelect
            :model-value="state.status"
            :options="statuses"
            :label="t('catalogue.status')"
            @update:model-value="
              (status) => set({ status: status as ListStatus })
            "
          />
        </div>
      </div>
      <RouterLink
        v-if="canCreate"
        :to="{ name: 'new-product' }"
        :class="buttonClasses()"
      >
        <Plus class="size-4" aria-hidden="true" />
        {{ t("products.new") }}
      </RouterLink>
    </div>

    <UiDataTable
      :page="state.page"
      :caption="t('products.caption')"
      :columns="columns"
      :rows="items"
      :row-key="(p) => p.id"
      :total="total"
      :page-size="PAGE_SIZE"
      :loading="loading"
      :error="error && t(error)"
      :empty-title="filtering ? t('catalogue.noMatches') : t('products.empty')"
      :empty-description="
        filtering
          ? t('catalogue.noMatchesDescription')
          : t('products.emptyDescription')
      "
      @update:page="(page) => set({ page })"
      @retry="reload"
    >
      <template #cell-name="{ row }">
        <RouterLink
          :to="{ name: 'product', params: { id: row.id } }"
          class="font-medium text-primary underline-offset-4 hover:underline"
        >
          {{ row.name }}
        </RouterLink>
      </template>
      <template #cell-active="{ row }">
        <UiBadge :tone="row.active ? 'success' : 'neutral'">
          {{ t(row.active ? "catalogue.active" : "catalogue.inactive") }}
        </UiBadge>
      </template>
      <template #card="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <RouterLink
              :to="{ name: 'product', params: { id: row.id } }"
              class="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {{ row.name }}
            </RouterLink>
            <span class="text-sm text-fg-muted">
              {{
                [category(row), storeroomName(row.defaultStoreroomId)]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </span>
          </div>
          <UiBadge v-if="!row.active">{{ t("catalogue.inactive") }}</UiBadge>
        </div>
      </template>
    </UiDataTable>
  </div>
</template>
