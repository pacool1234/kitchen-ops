<script setup lang="ts">
import {
  endpoints,
  ExtractedDocument,
  fieldErrors,
  type Document,
  type DocumentCheckFailure,
  type DocumentMatching,
  type LineMatch,
  type SavedDraft,
} from "@kitchen-ops/shared";
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue";
import { ApiError, call } from "../api";
import { isDirty, type FieldErrors } from "../catalogue/form";
import UnsavedDialog from "../catalogue/UnsavedDialog.vue";
import { useUnsavedGuard } from "../catalogue/unsaved";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";
import DocumentSupplier from "./DocumentSupplier.vue";
import { toDraft, toValues, type DraftValues } from "./draft-form";
import DraftForm from "./DraftForm.vue";
import DraftReadOnly from "./DraftReadOnly.vue";
import LineMappingDialog from "./LineMappingDialog.vue";
import LineProduct from "./LineProduct.vue";
import { failureLine } from "./list";
import { startLiveChecks } from "./live-checks";
import { mapping, orderedReasons } from "./review-state";

// Reviewing a document's draft (#118, decision 0037): the draft as it stands, corrected or as
// read, to correct. The checks run again a moment after each change, by the API; a value the
// draft's schema refuses (a 150% discount) shows on its field at once, from the same schema.
// Saving keeps the correction apart from what the model read, which shows below once there is
// one. Leaving with changes not saved asks first. Office and owner also choose the supplier,
// or create it, and confirm each line's product (#117); everyone sees what's left before posting.
const props = defineProps<{
  document: Document;
  mode: "all" | "quantities";
}>();
const emit = defineEmits<{ saved: [saved: SavedDraft]; reload: [] }>();
const t = useT();

const values = ref<DraftValues>(
  toValues(props.document.corrected ?? props.document.draft),
);
/** The draft as last saved, or as it came: what `dirty` compares with. */
const loaded = shallowRef(toDraft(values.value));
const dirty = computed(() => isDirty(toDraft(values.value), loaded.value));
const failures = ref<DocumentCheckFailure[]>(props.document.checkFailures);

/** What the schema refuses, by field; shown once the field is left, or after a try to save. */
const invalid = ref<FieldErrors>({});
/** What the API refused when saving, until the next save. */
const refused = ref<FieldErrors>({});
const touched = reactive(new Set<string>());
const submitted = ref(false);
const saving = ref(false);

const live = startLiveChecks<ExtractedDocument>({
  delayMs: 500,
  check: (draft) =>
    call(endpoints.checkDocumentDraft, {
      params: { id: props.document.id },
      body: draft,
    }).then((answer) => answer.checkFailures),
  show: (shown) => {
    failures.value = shown;
  },
});
onUnmounted(() => live.stop());

/** The checks again for the draft on screen, if the schema takes it: shortly, through the API. */
function recheck() {
  const draft = toDraft(values.value);
  const parsed = ExtractedDocument.safeParse(draft);
  invalid.value = parsed.success ? {} : fieldErrors(parsed.error.issues, draft);
  if (parsed.success) live.changed(parsed.data);
  else live.cancel();
}
watch(values, recheck, { deep: true });

/** The supplier, each saved line's product and what's left before posting (#117). */
const matching = ref<DocumentMatching>();
async function loadMatching() {
  try {
    matching.value = await call(endpoints.getDocumentMatching, {
      params: { id: props.document.id },
    });
  } catch {
    // Without it, the screen still corrects the draft; the next save asks again.
  }
}
onMounted(loadMatching);

/** A supplier chosen: its lines' products, and the checks again (its numbers already received). */
function supplierChosen(next: DocumentMatching) {
  matching.value = next;
  recheck();
}

const reasons = computed(() =>
  matching.value ? orderedReasons(matching.value.reviewReasons) : [],
);
/** Lines added or removed since saving: the saved lines' products can't be put on these. */
const linesMoved = computed(
  () => values.value.lines.length !== loaded.value.lines.length,
);
/** A saved line's product: matched, suggested, or none; undefined before it's known. */
function lineMatch(index: number): LineMatch | null | undefined {
  if (!matching.value || linesMoved.value) return undefined;
  return matching.value.lines[index]?.match ?? null;
}
function lineMapping(index: number) {
  return mapping({
    hasSupplier: Boolean(matching.value?.supplier),
    dirty: dirty.value,
    match: lineMatch(index) ?? null,
  });
}

/** The line whose product is being chosen, from 0; null when none is. */
const mappingLine = ref<number | null>(null);
const mappingOpen = computed({
  get: () => mappingLine.value !== null,
  set: (open) => {
    if (!open) mappingLine.value = null;
  },
});
/** The saved line, to say which it is: "T-01 · Tomate pera". */
const savedLineText = computed(() => {
  const line =
    mappingLine.value === null
      ? undefined
      : loaded.value.lines[mappingLine.value];
  return [line?.supplierCode, line?.description].filter(Boolean).join(" · ");
});
const mappingSuggestion = computed(() => {
  const match =
    mappingLine.value === null ? null : lineMatch(mappingLine.value);
  return match?.by === "suggestion" ? match.product : undefined;
});
const readSupplier = computed(() => {
  const { supplier } = toDraft(values.value);
  return { name: supplier.name ?? "", taxId: supplier.taxId ?? "" };
});

/** Percentages and the date have their own words for "not valid". */
function ownWords(path: string): Partial<Record<string, MessageKey>> {
  if (path === "issueDate") return { invalid: "documents.review.dateInvalid" };
  if (/(discountPercent|vatRate|\.rate)$/.test(path)) {
    return { invalid: "documents.review.percentInvalid" };
  }
  return {};
}

const capitalised = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What a field or block shows: the schema's refusal once it's been left or saving was tried,
 * else the API's, else the checks it fails, in words.
 */
function errorAt(path: string): string | undefined {
  const code =
    (touched.has(path) || submitted.value ? invalid.value[path] : undefined) ??
    refused.value[path];
  if (code) return t(fieldMessageKey(code, ownWords(path)));
  const failed = failures.value.filter((f) => f.path === path);
  if (failed.length === 0) return undefined;
  return failed
    .map((f) => capitalised(t(`documents.checks.${f.check}`)))
    .join(". ");
}

/** A failed check in words, with its line if it's on one: "Línea 4: el importe no cuadra…". */
function failureText(failure: DocumentCheckFailure): string {
  const check = t(`documents.checks.${failure.check}`);
  const line = failureLine(failure.path);
  return line ? t("documents.onLine", { line, check }) : capitalised(check);
}

/** To the field a failure is on: its input, or the first one in its block. */
function goTo(path: string) {
  const target = document.querySelector<HTMLElement>(`[data-field="${path}"]`);
  const focusable =
    target?.matches("input, button, [tabindex]") === true
      ? target
      : target?.querySelector<HTMLElement>("input, button");
  focusable?.focus();
}

/** Each field marks itself left, so its schema error can show. */
function onFocusOut(event: FocusEvent) {
  const field = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-field]",
  );
  if (field?.dataset.field) touched.add(field.dataset.field);
}

async function save() {
  submitted.value = true;
  const draft = toDraft(values.value);
  const parsed = ExtractedDocument.safeParse(draft);
  if (!parsed.success) return;
  saving.value = true;
  refused.value = {};
  try {
    const saved = await call(endpoints.saveDocumentDraft, {
      params: { id: props.document.id },
      body: parsed.data,
    });
    live.cancel();
    failures.value = saved.checkFailures;
    loaded.value = toDraft(values.value);
    submitted.value = false;
    emit("saved", saved);
    showToast({ tone: "success", title: t("documents.review.saved") });
    void loadMatching();
  } catch (caught) {
    if (caught instanceof ApiError && caught.fields) {
      refused.value = { ...caught.fields };
    }
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
    // No longer in review, posted by someone else meanwhile: show it as it is now.
    if (caught instanceof ApiError && caught.code === "not_in_review") {
      emit("reload");
    }
  } finally {
    saving.value = false;
  }
}

const guard = useUnsavedGuard(dirty);
</script>

<template>
  <section class="flex flex-col gap-6" aria-labelledby="review-heading">
    <h2 id="review-heading" class="text-lg font-semibold">
      {{ t("documents.review.heading") }}
    </h2>
    <UiAlert v-if="!document.draft && !document.corrected" tone="info">
      {{ t("documents.noDraft") }}
    </UiAlert>
    <p v-if="mode === 'quantities'" class="text-fg-muted">
      {{ t("documents.review.quantitiesHint") }}
    </p>

    <section
      v-if="matching"
      class="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5"
      aria-labelledby="left-heading"
    >
      <h3 id="left-heading" class="font-semibold">
        {{ t("documents.left") }}
      </h3>
      <ul v-if="reasons.length > 0" class="flex list-disc flex-col gap-1 ps-5">
        <li v-for="reason in reasons" :key="reason">
          {{ t(`documents.reasons.${reason}`) }}
        </li>
      </ul>
      <p v-else>{{ t("documents.nothingLeft") }}</p>
    </section>

    <DocumentSupplier
      v-if="mode === 'all' && matching"
      :document-id="document.id"
      :matching="matching"
      :read="readSupplier"
      @chosen="supplierChosen"
    />

    <section
      class="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5"
      aria-labelledby="checks-heading"
    >
      <h3 id="checks-heading" class="font-semibold">
        {{ t("documents.checksHeading") }}
      </h3>
      <ul v-if="failures.length > 0" class="flex list-disc flex-col gap-1 ps-5">
        <li v-for="(failure, index) in failures" :key="index">
          <button
            type="button"
            class="text-start text-danger underline underline-offset-4"
            @click="goTo(failure.path)"
          >
            {{ failureText(failure) }}
          </button>
        </li>
      </ul>
      <p v-else>{{ t("documents.allPassed") }}</p>
    </section>

    <form
      class="flex flex-col gap-6"
      novalidate
      @submit.prevent="save"
      @focusout="onFocusOut"
    >
      <DraftForm v-model="values" :mode="mode" :error-at="errorAt">
        <template #line="{ index }">
          <LineProduct
            v-if="lineMatch(index) !== undefined"
            :match="lineMatch(index) ?? null"
            v-bind="lineMapping(index)"
            @choose="mappingLine = index"
          />
          <p
            v-else-if="linesMoved"
            class="border-t border-line pt-3 text-sm text-fg-muted"
          >
            {{ t("documents.matching.blocked.unsaved") }}
          </p>
        </template>
      </DraftForm>
      <div class="flex justify-end">
        <UiButton type="submit" :loading="saving">
          {{ t("documents.review.save") }}
        </UiButton>
      </div>
    </form>

    <details
      v-if="document.corrected && document.draft"
      class="rounded-lg border border-line bg-surface p-5"
    >
      <summary class="cursor-pointer font-semibold">
        {{ t("documents.review.modelRead") }}
      </summary>
      <div class="mt-4">
        <DraftReadOnly
          :draft="document.draft"
          :lines-label="t('documents.review.readLines')"
        />
      </div>
    </details>

    <LineMappingDialog
      v-model:open="mappingOpen"
      :document-id="document.id"
      :line="(mappingLine ?? 0) + 1"
      :line-text="savedLineText"
      :suggested="mappingSuggestion"
      @mapped="(next) => (matching = next)"
    />
    <UnsavedDialog
      v-model:open="guard.asking.value"
      @stay="guard.stay"
      @leave="guard.leave"
    />
  </section>
</template>
