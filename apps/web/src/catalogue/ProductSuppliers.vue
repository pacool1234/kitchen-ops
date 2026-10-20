<script setup lang="ts">
import {
  endpoints,
  type Product,
  type SupplierProduct,
} from "@kitchen-ops/shared";
import { computed, ref, useId, watch } from "vue";
import { RouterLink } from "vue-router";
import { ApiError, call } from "../api";
import UiBadge from "../components/ui/UiBadge.vue";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import { usePackText } from "./pack-text";

// A product's supplier products, on its page (#89): who sells it, under what code and in what
// pack. Read here by every role; they're added and changed on each supplier's page.
const props = defineProps<{ product: Product }>();
const t = useT();
const packText = usePackText();
const headingId = useId();

/** A product is sold by a few suppliers: all of them at once. */
const LIMIT = 200;
const rows = ref<SupplierProduct[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref<MessageKey>();

async function load() {
  loading.value = true;
  error.value = undefined;
  try {
    const page = await call(endpoints.listSupplierProducts, {
      query: { productId: props.product.id, status: "all", pageSize: LIMIT },
    });
    rows.value = page.items;
    total.value = page.total;
  } catch (caught) {
    error.value =
      caught instanceof ApiError
        ? errorMessageKey(caught)
        : "catalogue.loadFailed";
  } finally {
    loading.value = false;
  }
}
// Again when its units change: a pack's base units follow them.
watch(() => [props.product.id, props.product.conversions], load, {
  immediate: true,
});

const pack = (s: SupplierProduct) =>
  packText(s.pack, s.product.baseUnit, s.packBaseUnits);
const columns = computed<Column<SupplierProduct>[]>(() => [
  {
    key: "supplier",
    label: t("supplierProducts.supplier"),
    value: (s) => s.supplier.name,
  },
  {
    key: "code",
    label: t("supplierProducts.code"),
    value: (s) => s.code ?? "—",
  },
  {
    key: "description",
    label: t("supplierProducts.description"),
    value: (s) => s.description,
  },
  { key: "pack", label: t("supplierProducts.pack"), value: pack },
  {
    key: "active",
    label: t("catalogue.status"),
    value: (s) => t(s.active ? "catalogue.active" : "catalogue.inactive"),
  },
]);
</script>

<template>
  <section :aria-labelledby="headingId" class="flex flex-col gap-3">
    <h2 :id="headingId" class="text-xl font-semibold">
      {{ t("products.soldBy") }}
    </h2>
    <UiDataTable
      :caption="t('products.soldByCaption')"
      :columns="columns"
      :rows="rows"
      :row-key="(s) => s.id"
      :total="total"
      :page-size="LIMIT"
      :loading="loading"
      :error="error && t(error)"
      :empty-title="t('products.notSold')"
      :empty-description="t('products.notSoldDescription')"
      @retry="load"
    >
      <template #cell-supplier="{ row }">
        <RouterLink
          :to="{ name: 'supplier', params: { id: row.supplier.id } }"
          class="font-medium text-primary underline-offset-4 hover:underline"
        >
          {{ row.supplier.name }}
        </RouterLink>
      </template>
      <template #cell-pack="{ row }">
        <span class="tabular whitespace-nowrap">{{ pack(row) }}</span>
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
              :to="{ name: 'supplier', params: { id: row.supplier.id } }"
              class="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {{ row.supplier.name }}
            </RouterLink>
            <span class="text-sm">{{ row.description }}</span>
            <span class="text-sm text-fg-muted tabular">
              {{ [row.code, pack(row)].filter(Boolean).join(" · ") }}
            </span>
          </div>
          <UiBadge v-if="!row.active">{{ t("catalogue.inactive") }}</UiBadge>
        </div>
      </template>
    </UiDataTable>
  </section>
</template>
