<script setup lang="ts" generic="Row">
import { Locale } from "@kitchen-ops/shared";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useT } from "../../i18n";
import { formatCount } from "../../i18n/format";
import UiButton from "./UiButton.vue";
import UiEmptyState from "./UiEmptyState.vue";
import UiErrorState from "./UiErrorState.vue";
import UiSkeleton from "./UiSkeleton.vue";
import {
  nextSort,
  pageBounds,
  pageCount,
  type Sort,
  type SortColumn,
} from "./table";

// A table of rows with sorting and pages (#85, decision 0024). It's controlled: it shows the
// rows it's given and emits the sort and page asked for, so the rows can be sorted and paged
// in the page (sortRows, pageRows in ./table) or by the API, without changing the table.

export interface Column<R> extends SortColumn<R> {
  label: string;
  /** Numbers and amounts line up at the end. */
  align?: "start" | "end";
  sortable?: boolean;
}

const props = defineProps<{
  /** Names the table for screen readers; shown above it if `captionVisible`. */
  caption: string;
  captionVisible?: boolean;
  columns: readonly Column<Row>[];
  /** The rows of the current page. */
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Rows in every page together. */
  total: number;
  pageSize: number;
  loading?: boolean;
  /** Shown instead of the rows, with "Reintentar", which emits `retry`. */
  error?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}>();
defineEmits<{ retry: [] }>();
const slots = defineSlots<{
  /** A cell's content, `cell-<column key>`, instead of the column's value as text. */
  [cell: `cell-${string}`]: (props: { row: Row }) => unknown;
  /** Below the empty state's text: the action that adds the first row. */
  empty?: () => unknown;
  /**
   * A row as a card, for phones: given this, below 768px the rows are a list of cards instead
   * of the table. Only one of the two shows, so a screen reader meets one.
   */
  card?: (props: { row: Row }) => unknown;
}>();

const sort = defineModel<Sort | null>("sort", { default: null });
const page = defineModel<number>("page", { default: 1 });

const t = useT();
const { locale } = useI18n();
const pages = computed(() => pageCount(props.total, props.pageSize));
const bounds = computed(() =>
  pageBounds(page.value, props.pageSize, props.total),
);
const count = (n: number) => formatCount(n, Locale.parse(locale.value));

/** What aria-sort says on a header: only the sorted column has it. */
function ariaSort(column: Column<Row>) {
  if (sort.value?.key !== column.key) return undefined;
  return sort.value.direction === "asc" ? "ascending" : "descending";
}

function sortIcon(column: Column<Row>) {
  if (sort.value?.key !== column.key) return ArrowUpDown;
  return sort.value.direction === "asc" ? ArrowUp : ArrowDown;
}

// With cards, an error or an empty list shows once, for both layouts, not once in each.
const cardStates = computed(
  () =>
    Boolean(slots.card) &&
    !props.loading &&
    (Boolean(props.error) || props.rows.length === 0),
);

const align = (column: Column<Row>) =>
  column.align === "end" ? "text-end" : "text-start";
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-line bg-surface text-fg">
    <template v-if="cardStates">
      <UiErrorState
        v-if="error"
        :message="error"
        retryable
        @retry="$emit('retry')"
      />
      <UiEmptyState
        v-else
        :title="emptyTitle ?? t('ui.table.empty')"
        :description="emptyDescription"
      >
        <slot v-if="$slots.empty" name="empty" />
      </UiEmptyState>
    </template>
    <!-- A wide table scrolls on its own; the region lets a keyboard scroll it too. -->
    <div
      v-else
      :class="['overflow-x-auto', $slots.card && 'hidden md:block']"
      role="region"
      :aria-label="caption"
      tabindex="0"
    >
      <table
        class="w-full border-collapse text-sm"
        :aria-busy="loading || undefined"
      >
        <caption
          :class="
            captionVisible
              ? 'px-4 pt-4 pb-2 text-start text-lg font-semibold'
              : 'sr-only'
          "
        >
          {{
            caption
          }}
        </caption>
        <thead class="bg-surface-muted">
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :aria-sort="ariaSort(column)"
              :class="[
                'border-b border-line px-4 py-3 font-semibold whitespace-nowrap',
                align(column),
              ]"
            >
              <button
                v-if="column.sortable"
                type="button"
                class="-mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 hover:text-primary"
                @click="
                  sort = nextSort(sort, column.key);
                  page = 1;
                "
              >
                {{ column.label }}
                <component
                  :is="sortIcon(column)"
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
              </button>
              <template v-else>{{ column.label }}</template>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-if="loading">
            <tr
              v-for="row in Math.min(pageSize, 5)"
              :key="row"
              class="border-b border-line last:border-0"
            >
              <td v-for="column in columns" :key="column.key" class="px-4 py-3">
                <UiSkeleton />
              </td>
            </tr>
          </template>
          <tr v-else-if="error">
            <td :colspan="columns.length">
              <UiErrorState
                :message="error"
                retryable
                @retry="$emit('retry')"
              />
            </td>
          </tr>
          <tr v-else-if="rows.length === 0">
            <td :colspan="columns.length">
              <UiEmptyState
                :title="emptyTitle ?? t('ui.table.empty')"
                :description="emptyDescription"
              >
                <slot v-if="$slots.empty" name="empty" />
              </UiEmptyState>
            </td>
          </tr>
          <template v-else>
            <tr
              v-for="row in rows"
              :key="rowKey(row)"
              class="border-b border-line last:border-0 hover:bg-surface-muted"
            >
              <td
                v-for="column in columns"
                :key="column.key"
                :class="['px-4 py-3', align(column)]"
              >
                <slot :name="`cell-${column.key}`" :row="row">
                  {{ column.value(row) }}
                </slot>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div v-if="$slots.card && !cardStates" class="md:hidden">
      <ul v-if="loading" :aria-label="caption" aria-busy="true">
        <li
          v-for="row in Math.min(pageSize, 3)"
          :key="row"
          class="flex flex-col gap-2 border-b border-line p-4 last:border-0"
        >
          <UiSkeleton />
          <UiSkeleton />
        </li>
      </ul>
      <ul v-else :aria-label="caption">
        <li
          v-for="row in rows"
          :key="rowKey(row)"
          class="border-b border-line p-4 last:border-0"
        >
          <slot name="card" :row="row" />
        </li>
      </ul>
    </div>
    <p v-if="loading" role="status" class="sr-only">{{ t("ui.loading") }}</p>
    <nav
      v-if="!error && total > 0"
      :aria-label="t('ui.table.pagination')"
      class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm"
    >
      <p class="text-fg-muted tabular">
        {{
          t("ui.table.showing", {
            first: count(bounds.first),
            last: count(bounds.last),
            total: count(total),
          })
        }}
      </p>
      <div class="flex items-center gap-2">
        <UiButton
          variant="secondary"
          size="sm"
          :disabled="page <= 1"
          :aria-label="t('ui.table.previous')"
          @click="page -= 1"
        >
          <ChevronLeft class="size-4" aria-hidden="true" />
        </UiButton>
        <span class="tabular" aria-live="polite">
          {{ t("ui.table.page", { page: count(page), pages: count(pages) }) }}
        </span>
        <UiButton
          variant="secondary"
          size="sm"
          :disabled="page >= pages"
          :aria-label="t('ui.table.next')"
          @click="page += 1"
        >
          <ChevronRight class="size-4" aria-hidden="true" />
        </UiButton>
      </div>
    </nav>
  </div>
</template>
