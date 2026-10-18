<script setup lang="ts">
import { endpoints, Locale, type Product } from "@kitchen-ops/shared";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, call } from "../api";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import { pageRows, sortRows, type Sort } from "../components/ui/table";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";

// The active products and the unit each is counted in. The list comes whole and is sorted
// and paged here; the catalogue (#89) will ask the API for one page at a time.
const t = useT();
const { locale } = useI18n();
const products = ref<Product[]>([]);
const loading = ref(true);
const error = ref<MessageKey>();
const sort = ref<Sort | null>({ key: "name", direction: "asc" });
const page = ref(1);
const PAGE_SIZE = 20;

async function load() {
  loading.value = true;
  error.value = undefined;
  try {
    products.value = (await call(endpoints.listProducts)).products;
  } catch (caught) {
    // The API's answer if it gave one, else most likely the connection.
    error.value =
      caught instanceof ApiError
        ? errorMessageKey(caught)
        : "products.loadFailed";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const columns = computed<Column<Product>[]>(() => [
  {
    key: "name",
    label: t("products.name"),
    sortable: true,
    value: (p) => p.name,
  },
  {
    key: "baseUnit",
    label: t("products.baseUnit"),
    sortable: true,
    value: (p) => t(`units.${p.baseUnit}`),
  },
]);
const rows = computed(() =>
  pageRows(
    sortRows(
      products.value,
      sort.value,
      columns.value,
      Locale.parse(locale.value),
    ),
    page.value,
    PAGE_SIZE,
  ),
);
</script>

<template>
  <UiDataTable
    v-model:sort="sort"
    v-model:page="page"
    :caption="t('products.caption')"
    :columns="columns"
    :rows="rows"
    :row-key="(p) => p.id"
    :total="products.length"
    :page-size="PAGE_SIZE"
    :loading="loading"
    :error="error && t(error)"
    :empty-title="t('products.empty')"
    :empty-description="t('products.emptyDescription')"
    @retry="load"
  />
</template>
