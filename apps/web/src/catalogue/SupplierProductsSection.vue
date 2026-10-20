<script setup lang="ts">
import { endpoints, mayCall, type SupplierProduct } from "@kitchen-ops/shared";
import { Pencil, Plus } from "lucide-vue-next";
import { computed, ref, useId, watch } from "vue";
import { RouterLink } from "vue-router";
import { ApiError, call } from "../api";
import UiBadge from "../components/ui/UiBadge.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import { currentUser } from "../session";
import { usePackText } from "./pack-text";
import SupplierProductDialog from "./SupplierProductDialog.vue";

// A supplier's products, on its page (#89): its codes and packs, each mapped to one of our
// products. Office and owner add and change them in a dialog; counter staff read them.
const props = defineProps<{ supplierId: string }>();
const t = useT();
const packText = usePackText();
const headingId = useId();
const role = computed(() => currentUser.value?.role ?? null);
const canAdd = computed(() =>
  mayCall(endpoints.createSupplierProduct, role.value),
);
const canEdit = computed(() =>
  mayCall(endpoints.updateSupplierProduct, role.value),
);

/** A supplier sells tens of products, not thousands: all of them at once. */
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
      query: { supplierId: props.supplierId, status: "all", pageSize: LIMIT },
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
watch(() => props.supplierId, load, { immediate: true });

const dialogOpen = ref(false);
const editing = ref<SupplierProduct>();
function open(row?: SupplierProduct) {
  editing.value = row;
  dialogOpen.value = true;
}

const pack = (s: SupplierProduct) =>
  packText(s.pack, s.product.baseUnit, s.packBaseUnits);
const columns = computed<Column<SupplierProduct>[]>(() => [
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
  {
    key: "product",
    label: t("supplierProducts.product"),
    value: (s) => s.product.name,
  },
  { key: "pack", label: t("supplierProducts.pack"), value: pack },
  {
    key: "active",
    label: t("catalogue.status"),
    value: (s) => t(s.active ? "catalogue.active" : "catalogue.inactive"),
  },
  ...(canEdit.value
    ? [
        {
          key: "edit",
          label: t("supplierProducts.actions"),
          value: () => "",
        } as Column<SupplierProduct>,
      ]
    : []),
]);
</script>

<template>
  <section :aria-labelledby="headingId" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 :id="headingId" class="text-xl font-semibold">
        {{ t("supplierProducts.title") }}
      </h2>
      <UiButton v-if="canAdd" variant="secondary" :icon="Plus" @click="open()">
        {{ t("supplierProducts.add") }}
      </UiButton>
    </div>
    <UiDataTable
      :caption="t('supplierProducts.caption')"
      :columns="columns"
      :rows="rows"
      :row-key="(s) => s.id"
      :total="total"
      :page-size="LIMIT"
      :loading="loading"
      :error="error && t(error)"
      :empty-title="t('supplierProducts.empty')"
      :empty-description="t('supplierProducts.emptyDescription')"
      @retry="load"
    >
      <template #cell-code="{ row }">
        <span class="font-medium tabular">{{ row.code ?? "—" }}</span>
      </template>
      <template #cell-product="{ row }">
        <RouterLink
          :to="{ name: 'product', params: { id: row.product.id } }"
          class="font-medium text-primary underline-offset-4 hover:underline"
        >
          {{ row.product.name }}
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
      <template #cell-edit="{ row }">
        <UiButton
          variant="ghost"
          size="sm"
          :aria-label="
            t('supplierProducts.edit', { name: row.code ?? row.description })
          "
          @click="open(row)"
        >
          <Pencil class="size-4" aria-hidden="true" />
        </UiButton>
      </template>
      <template #card="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="font-semibold">{{ row.description }}</span>
            <RouterLink
              :to="{ name: 'product', params: { id: row.product.id } }"
              class="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {{ row.product.name }}
            </RouterLink>
            <span class="text-sm text-fg-muted tabular">
              {{ [row.code, pack(row)].filter(Boolean).join(" · ") }}
            </span>
            <UiBadge v-if="!row.active" class="self-start">
              {{ t("catalogue.inactive") }}
            </UiBadge>
          </div>
          <UiButton
            v-if="canEdit"
            variant="ghost"
            size="sm"
            :aria-label="
              t('supplierProducts.edit', { name: row.code ?? row.description })
            "
            @click="open(row)"
          >
            <Pencil class="size-4" aria-hidden="true" />
          </UiButton>
        </div>
      </template>
    </UiDataTable>
    <SupplierProductDialog
      v-if="canAdd || canEdit"
      v-model:open="dialogOpen"
      :supplier-id="supplierId"
      :editing="editing"
      @saved="load"
    />
  </section>
</template>
