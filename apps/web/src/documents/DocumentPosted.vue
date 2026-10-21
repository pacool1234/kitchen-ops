<script setup lang="ts">
import {
  endpoints,
  Locale,
  mayCall,
  type Document,
  type DocumentPosting,
  type PostedLine,
  type PostedMovement,
} from "@kitchen-ops/shared";
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRouter } from "vue-router";
import { call } from "../api";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import { showToast } from "../components/ui/toasts";
import { useT } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import {
  formatDate,
  formatPrintedDecimal,
  formatQuantity,
  formatUnitCost,
} from "../i18n/format";
import { currentUser } from "../session";

// A posted document (#119, decision 0034): read-only, with what each line put in stock, where
// and at what cost. A reversed one says when and by whom, and the movements that undid it. The
// owner reverses it, and then may make a corrected copy of it to review and post again. An
// invoice's line links to the delivery-note line it billed, and a delivery note's line to the
// invoices that bill it (#120).
const props = defineProps<{ document: Document }>();
const emit = defineEmits<{ changed: [] }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const router = useRouter();

const posting = shallowRef<DocumentPosting>();
const loadFailed = ref(false);
async function load() {
  loadFailed.value = false;
  try {
    posting.value = await call(endpoints.getDocumentPosting, {
      params: { id: props.document.id },
    });
  } catch {
    loadFailed.value = true;
  }
}
// Again when the document changes: reversed, say.
watch(() => props.document, load, { immediate: true });

const role = computed(() => currentUser.value?.role ?? null);
const mayReverse = computed(
  () =>
    mayCall(endpoints.reverseDocument, role.value) &&
    props.document.reversal === null,
);
const mayCopy = computed(
  () =>
    mayCall(endpoints.createDocumentCopy, role.value) &&
    props.document.reversal !== null &&
    props.document.copy === null,
);

/** "Entrada: 5 kg · Cámara frigorífica · 1,80 €/kg". */
function movementText(line: PostedLine, movement: PostedMovement): string {
  const { baseUnit } = line.product;
  return t("documents.posted.movement", {
    kind: t(
      `documents.posted.kinds.${movement.reverses ? "reversal" : movement.corrects ? "correction" : movement.kind}`,
    ),
    quantity: formatQuantity(movement.quantity, baseUnit, language.value),
    storeroom: movement.storeroom.name,
    cost: formatUnitCost(movement.unitCost, baseUnit, language.value),
  });
}

/** Another document's number, as a link to it says it. */
const numberOf = (document: { number: string | null }) =>
  document.number ?? t("documents.posted.noNumber");

/** The line as printed: "2 garrafa". */
const printed = (line: PostedLine) =>
  `${formatPrintedDecimal(line.quantity, language.value)} ${line.unit}`;

const confirmingReverse = ref(false);
const reversing = ref(false);
async function reverse() {
  reversing.value = true;
  try {
    posting.value = await call(endpoints.reverseDocument, {
      params: { id: props.document.id },
    });
    showToast({ tone: "success", title: t("documents.posted.reversed") });
    emit("changed");
  } catch (caught) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  } finally {
    confirmingReverse.value = false;
    reversing.value = false;
  }
}

const copying = ref(false);
async function copy() {
  copying.value = true;
  try {
    const made = await call(endpoints.createDocumentCopy, {
      params: { id: props.document.id },
    });
    showToast({ tone: "success", title: t("documents.posted.copied") });
    await router.push({ name: "document", params: { id: made.id } });
  } catch (caught) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  } finally {
    copying.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UiLoadingState v-if="!posting && !loadFailed" />
    <UiAlert v-else-if="loadFailed" tone="error">
      {{ t("documents.posted.loadFailed") }}
    </UiAlert>
    <template v-else-if="posting">
      <section class="flex flex-col gap-4" aria-labelledby="in-stock-heading">
        <h2 id="in-stock-heading" class="text-lg font-semibold">
          {{ t("documents.posted.heading") }}
        </h2>
        <ol class="flex flex-col gap-3">
          <li v-for="line in posting.lines" :key="line.position">
            <div
              role="group"
              :aria-label="t('documents.posted.line', { n: line.position })"
              class="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4"
            >
              <p class="font-medium">
                {{ t("documents.posted.line", { n: line.position }) }} ·
                {{ line.product.name }}
              </p>
              <p class="text-sm text-fg-muted tabular">{{ printed(line) }}</p>
              <p v-if="line.bills" class="text-sm">
                {{ t("documents.posted.bills", { line: line.bills.position }) }}
                <RouterLink
                  :to="{
                    name: 'document',
                    params: { id: line.bills.deliveryNote.id },
                  }"
                  class="text-primary underline underline-offset-4"
                >
                  {{
                    t("documents.posted.billsNote", {
                      number: numberOf(line.bills.deliveryNote),
                    })
                  }}
                </RouterLink>
              </p>
              <ul class="flex flex-col gap-1 text-sm tabular">
                <li v-for="movement in line.movements" :key="movement.id">
                  {{ movementText(line, movement) }}
                </li>
              </ul>
              <p
                v-if="line.bills && line.movements.length === 0"
                class="text-sm text-fg-muted"
              >
                {{ t("documents.posted.samePrice") }}
              </p>
              <p
                v-if="line.billedBy.length > 0"
                class="flex flex-wrap gap-x-2 text-sm"
              >
                <span>{{ t("documents.posted.billedBy") }}</span>
                <RouterLink
                  v-for="invoice in line.billedBy"
                  :key="invoice.id"
                  :to="{ name: 'document', params: { id: invoice.id } }"
                  class="text-primary underline underline-offset-4"
                >
                  {{
                    t("documents.titled", {
                      type: t("documents.types.invoice"),
                      number: numberOf(invoice),
                    })
                  }}
                </RouterLink>
              </p>
            </div>
          </li>
        </ol>
        <div v-if="mayReverse">
          <UiButton variant="danger" @click="confirmingReverse = true">
            {{ t("documents.posted.reverse") }}
          </UiButton>
        </div>
      </section>

      <section
        v-if="posting.reversal"
        class="flex flex-col gap-4"
        aria-labelledby="reversal-heading"
      >
        <h2 id="reversal-heading" class="text-lg font-semibold">
          {{ t("documents.posted.reversalHeading") }}
        </h2>
        <UiAlert tone="info">
          {{
            t("documents.posted.reversedOn", {
              date: formatDate(posting.reversal.date, language),
              name: posting.reversal.reversedBy.name,
            })
          }}
        </UiAlert>
        <ol class="flex flex-col gap-3">
          <li v-for="line in posting.reversal.lines" :key="line.position">
            <div
              role="group"
              :aria-label="t('documents.posted.line', { n: line.position })"
              class="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4"
            >
              <p class="font-medium">
                {{ t("documents.posted.line", { n: line.position }) }} ·
                {{ line.product.name }}
              </p>
              <ul class="flex flex-col gap-1 text-sm tabular">
                <li v-for="movement in line.movements" :key="movement.id">
                  {{ movementText(line, movement) }}
                </li>
              </ul>
            </div>
          </li>
        </ol>
        <div v-if="mayCopy">
          <UiButton :loading="copying" @click="copy">
            {{ t("documents.posted.copy") }}
          </UiButton>
        </div>
      </section>
    </template>

    <UiDialog
      v-model:open="confirmingReverse"
      :title="
        t(`documents.posted.reverseTitle.${document.type ?? 'delivery-note'}`, {
          number: document.number ?? '',
        })
      "
      :description="t('documents.posted.reverseText')"
    >
      <template #footer="{ close }">
        <UiButton variant="secondary" @click="close">
          {{ t("catalogue.cancel") }}
        </UiButton>
        <UiButton variant="danger" :loading="reversing" @click="reverse">
          {{ t("documents.posted.reverse") }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
