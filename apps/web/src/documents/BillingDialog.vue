<script setup lang="ts">
import { endpoints, Locale, type BillingCandidates } from "@kitchen-ops/shared";
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { call } from "../api";
import UiAlert from "../components/ui/UiAlert.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import { useT } from "../i18n";
import {
  formatDate,
  formatPrintedDecimal,
  formatUnitCost,
} from "../i18n/format";

// Choosing the delivery-note line an invoice's line bills (#120, decision 0041): every line it
// may bill, older ones included, by delivery note, each with its price now. A line chosen for
// another line of the invoice says so; choosing it moves it here.
const props = defineProps<{
  documentId: string;
  /** The invoice's line, from 1. */
  line: number;
  /** The line as saved, to say which it is: "A-05 · Aceite de oliva virgen extra 5 l". */
  lineText: string;
  /** While the choice is being saved. */
  saving: boolean;
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ chosen: [deliveryNoteLineId: string] }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));

const candidates = shallowRef<BillingCandidates["lines"]>();
const loadFailed = ref(false);
watch(open, async (isOpen) => {
  if (!isOpen) return;
  candidates.value = undefined;
  loadFailed.value = false;
  try {
    const answer = await call(endpoints.listBillingCandidates, {
      params: { id: props.documentId },
    });
    candidates.value = answer.lines;
  } catch {
    loadFailed.value = true;
  }
});

type Candidate = BillingCandidates["lines"][number];

/** The candidates by delivery note, in the order the API gives them. */
const groups = computed(() => {
  const byNote = new Map<string, Candidate[]>();
  for (const c of candidates.value ?? []) {
    byNote.set(c.deliveryNote.id, [
      ...(byNote.get(c.deliveryNote.id) ?? []),
      c,
    ]);
  }
  return [...byNote.values()].map((lines) => ({
    note: lines[0]!.deliveryNote,
    lines: [...lines].sort((a, b) => a.position - b.position),
  }));
});

const groupTitle = (note: Candidate["deliveryNote"]) =>
  t("documents.billing.group", {
    number: note.number ?? t("documents.billing.noNumber"),
    date: formatDate(note.date, language.value),
  });

/** "Línea 2: Aceite de oliva · 2 garrafa · 4,90 €/l". */
const candidateText = (c: Candidate) =>
  t("documents.billing.candidate", {
    n: c.position,
    product: c.product.name,
    quantity: `${formatPrintedDecimal(c.quantity, language.value)} ${c.unit}`,
    cost: formatUnitCost(c.unitCost, c.product.baseUnit, language.value),
  });
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="t('documents.billing.dialogTitle', { n: line })"
    :description="t('documents.billing.dialogText')"
  >
    <div class="flex flex-col gap-4">
      <p v-if="lineText" class="text-sm text-fg-muted">
        {{ t("documents.matching.lineRead", { text: lineText }) }}
      </p>
      <UiAlert v-if="loadFailed" tone="error">
        {{ t("documents.billing.loadFailed") }}
      </UiAlert>
      <UiLoadingState v-else-if="!candidates" />
      <p v-else-if="groups.length === 0">
        {{ t("documents.billing.noCandidates") }}
      </p>
      <section
        v-for="group in groups"
        v-else
        :key="group.note.id"
        class="flex flex-col gap-2"
        :aria-label="groupTitle(group.note)"
      >
        <h3 class="font-semibold">{{ groupTitle(group.note) }}</h3>
        <ul class="flex flex-col gap-2">
          <li v-for="candidate in group.lines" :key="candidate.id">
            <button
              type="button"
              class="flex w-full flex-col items-start gap-0.5 rounded-md border border-line px-3 py-2 text-start text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="saving"
              @click="emit('chosen', candidate.id)"
            >
              <span class="tabular">{{ candidateText(candidate) }}</span>
              <span
                v-if="candidate.chosenFor !== null"
                class="text-xs text-fg-muted"
              >
                {{
                  t("documents.billing.chosenFor", { n: candidate.chosenFor })
                }}
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  </UiDialog>
</template>
