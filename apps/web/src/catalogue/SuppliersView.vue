<script setup lang="ts">
import {
  endpoints,
  LIST_STATUSES,
  mayCall,
  type ListStatus,
  type Supplier,
} from "@kitchen-ops/shared";
import { Plus } from "lucide-vue-next";
import { computed } from "vue";
import { RouterLink } from "vue-router";
import UiBadge from "../components/ui/UiBadge.vue";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { buttonClasses } from "../components/ui/styles";
import { useT } from "../i18n";
import { currentUser } from "../session";
import CatalogueTabs from "./CatalogueTabs.vue";
import { PAGE_SIZE, useCatalogueList } from "./list-query";

// The suppliers (#89): searched as typed by name or tax ID, filtered by status, a page at a time
// from the API. Cards on a phone, a table from 768px.
const t = useT();
const { state, search, set, items, total, loading, error, filtering, reload } =
  useCatalogueList(endpoints.listSuppliers, [], "catalogue.loadFailed");
const canCreate = computed(() =>
  mayCall(endpoints.createSupplier, currentUser.value?.role ?? null),
);

const statuses = computed(() =>
  LIST_STATUSES.map((value) => ({
    value,
    label: t(`catalogue.statuses.${value}`),
  })),
);
const contact = (s: Supplier) =>
  [s.contactName, s.email, s.phone].filter(Boolean).join(" · ");
const columns = computed<Column<Supplier>[]>(() => [
  { key: "name", label: t("suppliers.name"), value: (s) => s.name },
  { key: "taxId", label: t("suppliers.taxId"), value: (s) => s.taxId },
  { key: "contact", label: t("suppliers.contact"), value: contact },
  {
    key: "active",
    label: t("catalogue.status"),
    value: (s) => t(s.active ? "catalogue.active" : "catalogue.inactive"),
  },
]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <CatalogueTabs />
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div class="sm:flex-1">
        <UiTextField
          v-model="search"
          type="search"
          :label="t('catalogue.search')"
          optional
          autocomplete="off"
        />
      </div>
      <div class="sm:w-44">
        <UiSelect
          :model-value="state.status"
          :options="statuses"
          :label="t('catalogue.status')"
          @update:model-value="
            (status) => set({ status: status as ListStatus })
          "
        />
      </div>
      <RouterLink
        v-if="canCreate"
        :to="{ name: 'new-supplier' }"
        :class="buttonClasses()"
      >
        <Plus class="size-4" aria-hidden="true" />
        {{ t("suppliers.new") }}
      </RouterLink>
    </div>

    <UiDataTable
      :page="state.page"
      :caption="t('suppliers.caption')"
      :columns="columns"
      :rows="items"
      :row-key="(s) => s.id"
      :total="total"
      :page-size="PAGE_SIZE"
      :loading="loading"
      :error="error && t(error)"
      :empty-title="filtering ? t('catalogue.noMatches') : t('suppliers.empty')"
      :empty-description="
        filtering
          ? t('catalogue.noMatchesDescription')
          : t('suppliers.emptyDescription')
      "
      @update:page="(page) => set({ page })"
      @retry="reload"
    >
      <template #cell-name="{ row }">
        <RouterLink
          :to="{ name: 'supplier', params: { id: row.id } }"
          class="font-medium text-primary underline-offset-4 hover:underline"
        >
          {{ row.name }}
        </RouterLink>
      </template>
      <template #cell-taxId="{ row }">
        <span class="tabular">{{ row.taxId }}</span>
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
              :to="{ name: 'supplier', params: { id: row.id } }"
              class="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {{ row.name }}
            </RouterLink>
            <span class="text-sm text-fg-muted tabular">{{ row.taxId }}</span>
            <span v-if="contact(row)" class="text-sm break-words text-fg-muted">
              {{ contact(row) }}
            </span>
          </div>
          <UiBadge v-if="!row.active">{{ t("catalogue.inactive") }}</UiBadge>
        </div>
      </template>
    </UiDataTable>
  </div>
</template>
