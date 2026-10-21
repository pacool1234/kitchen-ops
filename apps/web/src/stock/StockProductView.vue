<script setup lang="ts">
import {
  endpoints,
  Locale,
  seesCosts,
  type Product,
  type ProductMovement,
  type StockPlace,
} from "@kitchen-ops/shared";
import { computed, ref, shallowRef, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { ApiError, call } from "../api";
import UiBadge from "../components/ui/UiBadge.vue";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import { useT, type MessageKey } from "../i18n";
import {
  formatDate,
  formatMoney,
  formatQuantity,
  formatUnitCost,
} from "../i18n/format";
import { currentUser } from "../session";
import { usePageTitle } from "../shell/title";
import { movementDocument, signedQuantity } from "./movement";

// A product's stock (#150): what it has in each storeroom, and the movements behind it, newest
// first, each naming its document and linking to its page when it has one. Office and the owner
// also see costs and values.
const props = defineProps<{ id: string }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const placesId = useId();
const movementsId = useId();
const costs = computed(() =>
  currentUser.value ? seesCosts(currentUser.value.role) : false,
);
/** Every storeroom at once: a restaurant has a few. */
const ALL_PLACES = 200;
const MOVEMENTS_PAGE_SIZE = 20;

const product = shallowRef<Product>();
const loading = ref(true);
const loadError = ref<MessageKey>();
const places = shallowRef<StockPlace[]>([]);
const placesFailed = ref(false);
usePageTitle(() => product.value?.name);

async function loadPlaces() {
  placesFailed.value = false;
  try {
    places.value = (
      await call(endpoints.listStock, {
        query: { productId: props.id, pageSize: ALL_PLACES },
      })
    ).items;
  } catch {
    placesFailed.value = true;
  }
}

async function load() {
  loading.value = true;
  loadError.value = undefined;
  try {
    product.value = await call(endpoints.getProduct, {
      params: { id: props.id },
    });
  } catch (caught) {
    loadError.value =
      caught instanceof ApiError && caught.status === 404
        ? "catalogue.notFound"
        : "catalogue.loadFailed";
  } finally {
    loading.value = false;
  }
}

const movements = shallowRef<ProductMovement[]>([]);
const movementsTotal = ref(0);
const movementsPage = ref(1);
const movementsLoading = ref(true);
const movementsFailed = ref(false);
async function loadMovements() {
  movementsLoading.value = true;
  movementsFailed.value = false;
  try {
    const answer = await call(endpoints.listProductMovements, {
      params: { id: props.id },
      query: { page: movementsPage.value, pageSize: MOVEMENTS_PAGE_SIZE },
    });
    movements.value = answer.items;
    movementsTotal.value = answer.total;
  } catch {
    movementsFailed.value = true;
  } finally {
    movementsLoading.value = false;
  }
}

watch(
  () => props.id,
  () => {
    movementsPage.value = 1;
    void load();
    void loadPlaces();
    void loadMovements();
  },
  { immediate: true },
);
watch(movementsPage, loadMovements);

const baseUnit = computed(() => product.value?.baseUnit ?? "g");
const onHand = (p: StockPlace) =>
  formatQuantity(p.onHand, baseUnit.value, language.value);
const placeCost = (p: StockPlace) =>
  p.averageCost === undefined
    ? ""
    : formatUnitCost(p.averageCost, baseUnit.value, language.value);
const placeValue = (p: StockPlace) =>
  p.value === undefined ? "" : formatMoney(p.value, language.value);
const placeColumns = computed<Column<StockPlace>[]>(() => [
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
          value: placeCost,
          align: "end",
        },
        {
          key: "value",
          label: t("stock.value"),
          value: placeValue,
          align: "end",
        },
      ] as const)
    : []),
]);

const kind = (m: ProductMovement) =>
  movementDocument(m.document).reversal
    ? t("stock.reversal")
    : t(`stock.kinds.${m.kind}`);
const quantity = (m: ProductMovement) =>
  signedQuantity(m.quantity, baseUnit.value, language.value);
const movementCost = (m: ProductMovement) =>
  m.unitCost === undefined
    ? ""
    : formatUnitCost(m.unitCost, baseUnit.value, language.value);
const date = (m: ProductMovement) => formatDate(m.date, language.value);
/** Where a movement's document is shown, if it has a page. */
function linkOf(m: ProductMovement) {
  const link = movementDocument(m.document).link;
  return link && { name: link.name, params: { id: link.id } };
}
/** "Albarán ALB-0001", or a stock document's kind: "Merma". */
function documentText(m: ProductMovement) {
  const { type, number } = movementDocument(m.document);
  if (type === "delivery-note" || type === "invoice") {
    const name = t(`documents.types.${type}`);
    return number ? t("documents.titled", { type: name, number }) : name;
  }
  return t(`stock.documentTypes.${type}`);
}
const movementColumns = computed<Column<ProductMovement>[]>(() => [
  { key: "date", label: t("stock.date"), value: date },
  { key: "kind", label: t("stock.movement"), value: kind },
  {
    key: "storeroom",
    label: t("stock.storeroom"),
    value: (m) => m.storeroom.name,
  },
  {
    key: "quantity",
    label: t("stock.quantity"),
    value: quantity,
    align: "end",
  },
  ...(costs.value
    ? ([
        {
          key: "unitCost",
          label: t("stock.unitCost"),
          value: movementCost,
          align: "end",
        },
      ] as const)
    : []),
  { key: "document", label: t("stock.document"), value: documentText },
]);
</script>

<template>
  <UiLoadingState v-if="loading" />
  <UiErrorState v-else-if="loadError" :message="t(loadError)" />
  <div v-else class="flex flex-col gap-8">
    <section :aria-labelledby="placesId" class="flex flex-col gap-3">
      <h2 :id="placesId" class="text-xl font-semibold">
        {{ t("stock.places") }}
      </h2>
      <UiDataTable
        :caption="t('stock.placesCaption')"
        :columns="placeColumns"
        :rows="places"
        :row-key="(p) => p.storeroom.id"
        :total="places.length"
        :page-size="ALL_PLACES"
        :error="placesFailed ? t('stock.placesFailed') : undefined"
        :empty-title="t('stock.noPlaces')"
        @retry="loadPlaces"
      >
        <template #cell-onHand="{ row }">
          <span class="tabular whitespace-nowrap">{{ onHand(row) }}</span>
        </template>
        <template #cell-averageCost="{ row }">
          <span class="tabular whitespace-nowrap">{{ placeCost(row) }}</span>
        </template>
        <template #cell-value="{ row }">
          <span class="tabular whitespace-nowrap">{{ placeValue(row) }}</span>
        </template>
      </UiDataTable>
    </section>

    <section :aria-labelledby="movementsId" class="flex flex-col gap-3">
      <h2 :id="movementsId" class="text-xl font-semibold">
        {{ t("stock.movements") }}
      </h2>
      <UiDataTable
        v-model:page="movementsPage"
        :caption="t('stock.movementsCaption')"
        :columns="movementColumns"
        :rows="movements"
        :row-key="(m) => m.id"
        :total="movementsTotal"
        :page-size="MOVEMENTS_PAGE_SIZE"
        :loading="movementsLoading"
        :error="movementsFailed ? t('stock.movementsFailed') : undefined"
        :empty-title="t('stock.noMovements')"
        @retry="loadMovements"
      >
        <template #cell-kind="{ row }">
          <span class="flex flex-wrap items-center gap-2">
            {{ kind(row) }}
            <UiBadge v-if="row.adjustment" tone="warning">
              {{ t("stock.adjustment") }}
            </UiBadge>
          </span>
        </template>
        <template #cell-quantity="{ row }">
          <span class="tabular whitespace-nowrap">{{ quantity(row) }}</span>
        </template>
        <template #cell-unitCost="{ row }">
          <span class="tabular whitespace-nowrap">{{ movementCost(row) }}</span>
        </template>
        <template #cell-document="{ row }">
          <RouterLink
            v-if="linkOf(row)"
            :to="linkOf(row)!"
            class="text-primary underline-offset-4 hover:underline"
          >
            {{ documentText(row) }}
          </RouterLink>
          <template v-else>{{ documentText(row) }}</template>
        </template>
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="flex flex-wrap items-center gap-2 font-medium">
                {{ kind(row) }}
                <UiBadge v-if="row.adjustment" tone="warning">
                  {{ t("stock.adjustment") }}
                </UiBadge>
              </span>
              <span class="text-sm text-fg-muted">
                {{ date(row) }} · {{ row.storeroom.name }}
              </span>
              <RouterLink
                v-if="linkOf(row)"
                :to="linkOf(row)!"
                class="text-sm text-primary underline-offset-4 hover:underline"
              >
                {{ documentText(row) }}
              </RouterLink>
              <span v-else class="text-sm">{{ documentText(row) }}</span>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span class="tabular whitespace-nowrap font-medium">
                {{ quantity(row) }}
              </span>
              <span v-if="costs" class="tabular whitespace-nowrap text-sm">
                {{ movementCost(row) }}
              </span>
            </div>
          </div>
        </template>
      </UiDataTable>
    </section>
  </div>
</template>
