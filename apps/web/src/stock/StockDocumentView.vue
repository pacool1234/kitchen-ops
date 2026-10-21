<script setup lang="ts">
import {
  endpoints,
  Locale,
  mayCall,
  type PostedStockDocument,
  type StockDocumentLine,
  type StockDocumentMovement,
} from "@kitchen-ops/shared";
import { computed, ref, shallowRef, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, call } from "../api";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import {
  formatDate,
  formatPrintedDecimal,
  formatUnitCost,
} from "../i18n/format";
import { currentUser } from "../session";
import { usePageTitle } from "../shell/title";
import { signedQuantity } from "./movement";

// Waste or a transfer as it was posted (#151), read-only: where, why and by whom, and what each
// line moved, with its cost for office and the owner, which the API alone decides (#150). The
// owner reverses it, as any posted document; then it shows the movements that undid it.
const props = defineProps<{ id: string }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const movementsId = useId();
const reversalId = useId();

const document = shallowRef<PostedStockDocument>();
const loadError = ref<MessageKey>();
async function load() {
  loadError.value = undefined;
  try {
    document.value = await call(endpoints.getStockDocument, {
      params: { id: props.id },
    });
  } catch (caught) {
    loadError.value =
      caught instanceof ApiError && caught.status === 404
        ? "stock.posted.notFound"
        : "stock.posted.loadFailed";
  }
}
watch(
  () => props.id,
  () => {
    document.value = undefined;
    void load();
  },
  { immediate: true },
);

/** "Merma del 22/10/2026". */
usePageTitle(
  () =>
    document.value &&
    t("stock.posted.titled", {
      type: t(`stock.documentTypes.${document.value.type}`),
      date: formatDate(document.value.date, language.value),
    }),
);

/** "Merma · -1,5 kg · Cámara frigorífica", and its cost when it's sent. */
function movementText(line: StockDocumentLine, m: StockDocumentMovement) {
  const { baseUnit } = line.product;
  const parts = {
    kind: t(`stock.kinds.${m.kind}`),
    quantity: signedQuantity(m.quantity, baseUnit, language.value),
    storeroom: m.storeroom.name,
  };
  return m.unitCost === undefined
    ? t("stock.posted.movement", parts)
    : t("stock.posted.movementCost", {
        ...parts,
        cost: formatUnitCost(m.unitCost, baseUnit, language.value),
      });
}

/** A line typed in a purchase unit says so: "Registrado como 2 caja". */
function typedText(line: StockDocumentLine): string | undefined {
  if (line.unit === line.product.baseUnit) return undefined;
  return t("stock.posted.typed", {
    quantity: formatPrintedDecimal(line.quantity, language.value),
    unit: line.unit,
  });
}

const mayReverse = computed(
  () =>
    mayCall(endpoints.reverseDocument, currentUser.value?.role ?? null) &&
    document.value?.reversal === null,
);
const confirmingReverse = ref(false);
const reversing = ref(false);
async function reverse() {
  reversing.value = true;
  try {
    await call(endpoints.reverseDocument, { params: { id: props.id } });
    showToast({ tone: "success", title: t("stock.posted.reversed") });
    await load();
  } catch (caught) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  } finally {
    confirmingReverse.value = false;
    reversing.value = false;
  }
}
</script>

<template>
  <UiErrorState
    v-if="loadError"
    :message="t(loadError)"
    :retryable="loadError === 'stock.posted.loadFailed'"
    @retry="load"
  />
  <UiLoadingState v-else-if="!document" />
  <div v-else class="flex max-w-2xl flex-col gap-6">
    <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <template v-if="document.toStoreroom">
        <div>
          <dt class="text-sm text-fg-muted">{{ t("stock.posted.from") }}</dt>
          <dd>{{ document.storeroom.name }}</dd>
        </div>
        <div>
          <dt class="text-sm text-fg-muted">{{ t("stock.posted.to") }}</dt>
          <dd>{{ document.toStoreroom.name }}</dd>
        </div>
      </template>
      <div v-else>
        <dt class="text-sm text-fg-muted">
          {{ t("stock.posted.storeroom") }}
        </dt>
        <dd>{{ document.storeroom.name }}</dd>
      </div>
      <div v-if="document.reason">
        <dt class="text-sm text-fg-muted">{{ t("stock.posted.reason") }}</dt>
        <dd>{{ t(`stock.reasons.${document.reason}`) }}</dd>
      </div>
      <div v-if="document.note" class="sm:col-span-2">
        <dt class="text-sm text-fg-muted">{{ t("stock.posted.note") }}</dt>
        <dd class="whitespace-pre-line">{{ document.note }}</dd>
      </div>
      <div>
        <dt class="text-sm text-fg-muted">
          {{ t("stock.posted.recordedBy") }}
        </dt>
        <dd>{{ document.recordedBy.name }}</dd>
      </div>
    </dl>

    <section :aria-labelledby="movementsId" class="flex flex-col gap-4">
      <h2 :id="movementsId" class="text-lg font-semibold">
        {{ t("stock.posted.movements") }}
      </h2>
      <ol class="flex flex-col gap-3">
        <li
          v-for="line in document.lines"
          :key="line.position"
          class="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4"
        >
          <p class="font-medium">{{ line.product.name }}</p>
          <p v-if="typedText(line)" class="text-sm text-fg-muted tabular">
            {{ typedText(line) }}
          </p>
          <ul class="flex flex-col gap-1 text-sm tabular">
            <li v-for="m in line.movements" :key="m.id">
              {{ movementText(line, m) }}
            </li>
          </ul>
        </li>
      </ol>
      <div v-if="mayReverse">
        <UiButton variant="danger" @click="confirmingReverse = true">
          {{ t("stock.posted.reverse") }}
        </UiButton>
      </div>
    </section>

    <section
      v-if="document.reversal"
      :aria-labelledby="reversalId"
      class="flex flex-col gap-4"
    >
      <h2 :id="reversalId" class="text-lg font-semibold">
        {{ t("stock.posted.reversalHeading") }}
      </h2>
      <UiAlert tone="info">
        {{
          t("stock.posted.reversedOn", {
            date: formatDate(document.reversal.date, language),
            name: document.reversal.reversedBy.name,
          })
        }}
      </UiAlert>
      <ol class="flex flex-col gap-3">
        <li
          v-for="line in document.reversal.lines"
          :key="line.position"
          class="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4"
        >
          <p class="font-medium">{{ line.product.name }}</p>
          <ul class="flex flex-col gap-1 text-sm tabular">
            <li v-for="m in line.movements" :key="m.id">
              {{ movementText(line, m) }}
            </li>
          </ul>
        </li>
      </ol>
    </section>

    <UiDialog
      v-model:open="confirmingReverse"
      :title="t(`stock.posted.reverseTitle.${document.type}`)"
      :description="t('stock.posted.reverseText')"
    >
      <template #footer="{ close }">
        <UiButton variant="secondary" @click="close">
          {{ t("catalogue.cancel") }}
        </UiButton>
        <UiButton variant="danger" :loading="reversing" @click="reverse">
          {{ t("stock.posted.reverse") }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
