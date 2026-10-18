<script setup lang="ts">
import {
  endpoints,
  LIST_STATUSES,
  mayCall,
  STOREROOM_TYPES,
  type ListStatus,
  type Storeroom,
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

// The storerooms (#89): searched as typed, filtered by type and status, a page at a time from
// the API. Cards on a phone, a table from 768px.
const t = useT();
const { state, search, set, items, total, loading, error, filtering, reload } =
  useCatalogueList(endpoints.listStorerooms, ["type"], "catalogue.loadFailed");
const canCreate = computed(() =>
  mayCall(endpoints.createStoreroom, currentUser.value?.role ?? null),
);

// "" is every type: Reka's select can't hold an empty value, so it's "all" here.
const ALL = "all";
const types = computed(() => [
  { value: ALL, label: t("catalogue.allTypes") },
  ...STOREROOM_TYPES.map((value) => ({
    value,
    label: t(`storerooms.types.${value}`),
  })),
]);
const statuses = computed(() =>
  LIST_STATUSES.map((value) => ({
    value,
    label: t(`catalogue.statuses.${value}`),
  })),
);
const typeLabel = (s: Storeroom) => t(`storerooms.types.${s.type}`);
const columns = computed<Column<Storeroom>[]>(() => [
  { key: "name", label: t("storerooms.name"), value: (s) => s.name },
  { key: "type", label: t("storerooms.type"), value: typeLabel },
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
      <div class="sm:w-48">
        <UiSelect
          :model-value="state.filters.type || ALL"
          :options="types"
          :label="t('storerooms.type')"
          @update:model-value="
            (type) =>
              set({ filters: { type: type === ALL ? '' : (type ?? '') } })
          "
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
        :to="{ name: 'new-storeroom' }"
        :class="buttonClasses()"
      >
        <Plus class="size-4" aria-hidden="true" />
        {{ t("storerooms.new") }}
      </RouterLink>
    </div>

    <UiDataTable
      :page="state.page"
      :caption="t('storerooms.caption')"
      :columns="columns"
      :rows="items"
      :row-key="(s) => s.id"
      :total="total"
      :page-size="PAGE_SIZE"
      :loading="loading"
      :error="error && t(error)"
      :empty-title="
        filtering ? t('catalogue.noMatches') : t('storerooms.empty')
      "
      :empty-description="
        filtering
          ? t('catalogue.noMatchesDescription')
          : t('storerooms.emptyDescription')
      "
      @update:page="(page) => set({ page })"
      @retry="reload"
    >
      <template #cell-name="{ row }">
        <RouterLink
          :to="{ name: 'storeroom', params: { id: row.id } }"
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
              :to="{ name: 'storeroom', params: { id: row.id } }"
              class="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {{ row.name }}
            </RouterLink>
            <span class="text-sm text-fg-muted">{{ typeLabel(row) }}</span>
          </div>
          <UiBadge v-if="!row.active">{{ t("catalogue.inactive") }}</UiBadge>
        </div>
      </template>
    </UiDataTable>
  </div>
</template>
