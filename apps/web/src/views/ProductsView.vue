<script setup lang="ts">
import { endpoints, type Product } from "@kitchen-ops/shared";
import { computed, onMounted, ref, watch } from "vue";
import { ApiError, call } from "../api";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";

// The active products and the unit each is counted in, a page at a time from the API, in
// Spanish order. The catalogue's screens (#89) will add search, filters and editing.
const t = useT();
const products = ref<Product[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref<MessageKey>();
const page = ref(1);
const PAGE_SIZE = 20;

async function load() {
  loading.value = true;
  error.value = undefined;
  try {
    const result = await call(endpoints.listProducts, {
      query: { page: page.value, pageSize: PAGE_SIZE },
    });
    products.value = result.items;
    total.value = result.total;
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
watch(page, load);

const columns = computed<Column<Product>[]>(() => [
  {
    key: "name",
    label: t("products.name"),
    value: (p) => p.name,
  },
  {
    key: "baseUnit",
    label: t("products.baseUnit"),
    value: (p) => t(`units.${p.baseUnit}`),
  },
]);
</script>

<template>
  <UiDataTable
    v-model:page="page"
    :caption="t('products.caption')"
    :columns="columns"
    :rows="products"
    :row-key="(p) => p.id"
    :total="total"
    :page-size="PAGE_SIZE"
    :loading="loading"
    :error="error && t(error)"
    :empty-title="t('products.empty')"
    :empty-description="t('products.emptyDescription')"
    @retry="load"
  />
</template>
