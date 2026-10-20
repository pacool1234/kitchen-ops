<script setup lang="ts">
import {
  DOCUMENT_STATUSES,
  endpoints,
  Locale,
  type DocumentStatus,
  type DocumentSummary,
} from "@kitchen-ops/shared";
import { Upload } from "lucide-vue-next";
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ApiError, call } from "../api";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import { buttonClasses } from "../components/ui/styles";
import { latestOnly, PAGE_SIZE } from "../catalogue/list-query";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import { formatDate, formatDateTime } from "../i18n/format";
import { inProgress, readDocumentQuery, writeDocumentQuery } from "./list";
import { usePolling } from "./polling";
import StatusBadge from "./StatusBadge.vue";
import { documentName } from "./text";

// The documents (#106): newest first, filtered by status, a page at a time. While any shown is
// queued or being read, the list asks again every 2 seconds, so statuses change by themselves.
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const route = useRoute();
const router = useRouter();
const state = computed(() => readDocumentQuery(route.query));

const items = shallowRef<DocumentSummary[]>([]);
const total = ref(0);
const loading = ref(true);
const error = ref<MessageKey>();
const latest = latestOnly();

/** Loads the page; quietly, without the loading state, when polling. */
async function load(quiet = false) {
  if (!quiet) {
    loading.value = true;
    error.value = undefined;
  }
  try {
    const answer = await latest(() =>
      call(endpoints.listDocuments, {
        query: {
          status: state.value.status || undefined,
          page: state.value.page,
          pageSize: PAGE_SIZE,
        },
      }),
    );
    if (answer.stale) return;
    items.value = answer.value.items;
    total.value = answer.value.total;
    error.value = undefined;
  } catch (caught) {
    if (quiet) throw caught;
    error.value =
      caught instanceof ApiError
        ? errorMessageKey(caught)
        : "documents.loadFailed";
  } finally {
    if (!quiet) loading.value = false;
  }
  poller.check();
}
const poller = usePolling(
  () => load(true),
  () => inProgress(items.value),
);
watch(state, () => void load(), { immediate: true, deep: true });

function set(change: { status?: DocumentStatus | ""; page?: number }) {
  // A new filter goes back to page 1; replaced, so the back button leaves the list.
  void router.replace({
    query: writeDocumentQuery({ ...state.value, page: 1, ...change }),
  });
}

// "" is no filter: Reka's select can't hold an empty value, so "all" stands for it.
const ALL = "all";
const statuses = computed(() => [
  { value: ALL, label: t("documents.allStatuses") },
  ...DOCUMENT_STATUSES.map((value) => ({
    value,
    label: t(`documents.statuses.${value}`),
  })),
]);
const date = (d: DocumentSummary) =>
  d.date ? formatDate(d.date, language.value) : "";
const uploaded = (d: DocumentSummary) =>
  `${d.uploadedBy.name}, ${formatDateTime(d.uploadedAt, language.value)}`;
const columns = computed<Column<DocumentSummary>[]>(() => [
  {
    key: "document",
    label: t("documents.document"),
    value: (d) => documentName(t, d),
  },
  {
    key: "supplier",
    label: t("documents.supplier"),
    value: (d) => d.supplier?.name ?? "",
  },
  { key: "date", label: t("documents.date"), value: date },
  {
    key: "status",
    label: t("documents.status"),
    value: (d) => t(`documents.statuses.${d.status}`),
  },
  { key: "uploaded", label: t("documents.uploaded"), value: uploaded },
]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
    >
      <div class="sm:w-56">
        <UiSelect
          :model-value="state.status || ALL"
          :options="statuses"
          :label="t('documents.status')"
          @update:model-value="
            (status) =>
              set({
                status: status === ALL ? '' : (status as DocumentStatus),
              })
          "
        />
      </div>
      <RouterLink :to="{ name: 'new-document' }" :class="buttonClasses()">
        <Upload class="size-4" aria-hidden="true" />
        {{ t("documents.upload") }}
      </RouterLink>
    </div>

    <UiDataTable
      :page="state.page"
      :caption="t('documents.caption')"
      :columns="columns"
      :rows="items"
      :row-key="(d) => d.id"
      :total="total"
      :page-size="PAGE_SIZE"
      :loading="loading"
      :error="error && t(error)"
      :empty-title="
        state.status ? t('documents.noMatches') : t('documents.empty')
      "
      :empty-description="
        state.status
          ? t('documents.noMatchesDescription')
          : t('documents.emptyDescription')
      "
      @update:page="(page) => set({ page })"
      @retry="load()"
    >
      <template #cell-document="{ row }">
        <RouterLink
          :to="{ name: 'document', params: { id: row.id } }"
          class="font-medium text-primary underline-offset-4 hover:underline"
        >
          {{ documentName(t, row) }}
        </RouterLink>
      </template>
      <template #cell-date="{ row }">
        <span class="tabular">{{ date(row) }}</span>
      </template>
      <template #cell-status="{ row }">
        <span data-testid="list-status"
          ><StatusBadge :status="row.status"
        /></span>
      </template>
      <template #card="{ row }">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <RouterLink
              :to="{ name: 'document', params: { id: row.id } }"
              class="font-semibold text-primary underline-offset-4 hover:underline"
            >
              {{ documentName(t, row) }}
            </RouterLink>
            <span v-if="row.supplier" class="text-sm break-words text-fg-muted">
              {{ row.supplier.name }}
            </span>
            <span class="text-sm text-fg-muted">{{ uploaded(row) }}</span>
          </div>
          <span data-testid="list-status"
            ><StatusBadge :status="row.status"
          /></span>
        </div>
      </template>
    </UiDataTable>
  </div>
</template>
