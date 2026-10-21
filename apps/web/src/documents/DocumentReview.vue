<script setup lang="ts">
import {
  endpoints,
  ExtractedDocument,
  fieldErrors,
  mayCall,
  type Document,
  type DocumentCheckFailure,
  type DocumentMatching,
  type LineBilling as Billing,
  type LineBillingChoice,
  type LineMatch,
  type SavedDraft,
  type Storeroom,
} from "@kitchen-ops/shared";
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  useId,
  watch,
} from "vue";
import { ApiError, call } from "../api";
import { isDirty, type FieldErrors } from "../catalogue/form";
import UnsavedDialog from "../catalogue/UnsavedDialog.vue";
import { useUnsavedGuard } from "../catalogue/unsaved";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import type { SelectOption } from "../components/ui/options";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";
import BillingDialog from "./BillingDialog.vue";
import { billingOffers, billingWith, receivesStock } from "./billing-state";
import DocumentSupplier from "./DocumentSupplier.vue";
import { toDraft, toValues, type DraftValues } from "./draft-form";
import DraftForm from "./DraftForm.vue";
import DraftReadOnly from "./DraftReadOnly.vue";
import LineBilling from "./LineBilling.vue";
import LineMappingDialog from "./LineMappingDialog.vue";
import LineProduct from "./LineProduct.vue";
import LineStoreroom from "./LineStoreroom.vue";
import { failureLine } from "./list";
import { startLiveChecks } from "./live-checks";
import { posting, startingStoreroom } from "./posting-state";
import PriceDifferences from "./PriceDifferences.vue";
import { mapping, orderedReasons } from "./review-state";
import { currentUser } from "../session";

// Reviewing a document's draft (#118, decision 0037): the draft as it stands, corrected or as
// read, to correct. The checks run again a moment after each change, by the API; a value the
// draft's schema refuses (a 150% discount) shows on its field at once, from the same schema.
// Saving keeps the correction apart from what the model read, which shows below once there is
// one. Leaving with changes not saved asks first. Office and owner also choose the supplier,
// or create it, and confirm each line's product (#117); everyone sees what's left before posting.
// A delivery note is posted from here (#119, decision 0038), each line into its product's own
// storeroom or another one chosen, by whoever may post it with what's left. An invoice's lines
// each bill a delivery-note line, confirmed or chosen by office or the owner, or are received
// with it like a delivery note's; its price differences show, and they post it (#120).
const props = defineProps<{
  document: Document;
  mode: "all" | "quantities";
}>();
const emit = defineEmits<{
  saved: [saved: SavedDraft];
  reload: [];
  posted: [];
}>();
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
/** Loading it failed (#140): the page says so where what's left goes, and tries again. */
const matchingFailed = ref(false);
async function loadMatching() {
  try {
    matching.value = await call(endpoints.getDocumentMatching, {
      params: { id: props.document.id },
    });
    matchingFailed.value = false;
  } catch {
    // What was shown may be out of date now: none of it, so nothing is posted on it. The
    // draft can still be corrected.
    matching.value = undefined;
    matchingFailed.value = true;
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
/** As the API reads the saved draft: an invoice has a difference, even of nothing. */
const isInvoice = computed(
  () => matching.value !== undefined && matching.value.difference !== null,
);
/** What a saved invoice line bills; undefined when it's no invoice, or before it's known. */
function lineBilling(index: number): Billing | null | undefined {
  if (!isInvoice.value || linesMoved.value) return undefined;
  return matching.value?.lines[index]?.billing ?? null;
}
/** Whether a line goes into a storeroom: an invoice's only when received with it. */
function receivesAt(index: number): boolean {
  return receivesStock(isInvoice.value, lineBilling(index) ?? null);
}
const mayChoose = computed(() =>
  mayCall(endpoints.setDocumentBilling, currentUser.value?.role ?? null),
);
function billingOffersOf(index: number) {
  return billingOffers({
    mayChoose: mayChoose.value,
    hasSupplier: Boolean(matching.value?.supplier),
    dirty: dirty.value,
    billing: lineBilling(index) ?? null,
  });
}

/** Saves one line's choice, with every other line's as stored; false if it was refused. */
const billingNow = ref(false);
async function setBilling(
  index: number,
  choice: LineBillingChoice,
): Promise<boolean> {
  if (!matching.value) return false;
  billingNow.value = true;
  // What was refused about lines' choices before: this answer says it again if it still is.
  refused.value = Object.fromEntries(
    Object.entries(refused.value).filter(
      ([path]) => !/^lines\.\d+$/.test(path),
    ),
  );
  try {
    matching.value = await call(endpoints.setDocumentBilling, {
      params: { id: props.document.id },
      body: billingWith(
        matching.value.lines.map((l) => l.billing),
        index,
        choice,
      ),
    });
    showToast({ tone: "success", title: t("documents.billing.saved") });
    return true;
  } catch (caught) {
    if (caught instanceof ApiError && caught.fields) {
      refused.value = { ...refused.value, ...caught.fields };
    }
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
    if (caught instanceof ApiError && caught.code === "not_in_review") {
      emit("reload");
    } else {
      void loadMatching();
    }
    return false;
  } finally {
    billingNow.value = false;
  }
}
function confirmBilling(index: number) {
  const billing = lineBilling(index);
  if (billing?.by !== "suggested") return;
  void setBilling(index, {
    deliveryNoteLineId: billing.deliveryNoteLine.id,
  });
}

/** The line whose delivery-note line is being chosen, from 0; null when none is. */
const billingLine = ref<number | null>(null);
const billingOpen = computed({
  get: () => billingLine.value !== null,
  set: (open) => {
    if (!open) billingLine.value = null;
  },
});
async function chooseBilling(deliveryNoteLineId: string) {
  if (billingLine.value === null) return;
  if (await setBilling(billingLine.value, { deliveryNoteLineId })) {
    billingLine.value = null;
  }
}

function lineMapping(index: number) {
  return mapping({
    hasSupplier: Boolean(matching.value?.supplier),
    dirty: dirty.value,
    match: lineMatch(index) ?? null,
  });
}

/** Active storerooms, for each line's choice (#119): undefined until they've come. */
const storerooms = shallowRef<Storeroom[]>();
/** Loading them failed (#140): said with the matching's, not as a storeroom missing on each line. */
const storeroomsFailed = ref(false);
async function loadStorerooms() {
  try {
    const page = await call(endpoints.listStorerooms, {
      query: { status: "active", pageSize: 200 },
    });
    storerooms.value = page.items;
    storeroomsFailed.value = false;
  } catch {
    storeroomsFailed.value = true;
  }
}
onMounted(loadStorerooms);

/** Either failed: what's left before posting can't be shown, and posting isn't offered. */
const loadFailed = computed(
  () => matchingFailed.value || storeroomsFailed.value,
);
/** Loads again what failed; meanwhile, what's left shows as loading. */
function retryLoading() {
  if (matchingFailed.value) {
    matchingFailed.value = false;
    void loadMatching();
  }
  if (storeroomsFailed.value) {
    storeroomsFailed.value = false;
    void loadStorerooms();
  }
}
/**
 * Whether a line's storeroom can be shown: it's matched, and both the storerooms and its
 * product's own have come. A select keeps the words of the option it first showed, so it
 * waits for the ones it will keep.
 */
function storeroomShown(index: number): boolean {
  const product = matchedProduct(index);
  return (
    product !== undefined &&
    storerooms.value !== undefined &&
    ownStoreroom.has(product.id)
  );
}

/** The product a saved line is matched to, if it is: what it's posted as. */
function matchedProduct(index: number) {
  const match = lineMatch(index);
  return match && match.by !== "suggestion"
    ? match.supplierProduct.product
    : undefined;
}
/** Each matched product's own storeroom, by its ID, once fetched. */
const ownStoreroom = reactive(new Map<string, string | null>());
watch(matching, async (next) => {
  for (const line of next?.lines ?? []) {
    const match = line.match;
    if (!match || match.by === "suggestion") continue;
    const { id } = match.supplierProduct.product;
    if (ownStoreroom.has(id)) continue;
    try {
      const product = await call(endpoints.getProduct, { params: { id } });
      ownStoreroom.set(id, product.defaultStoreroomId);
    } catch {
      ownStoreroom.set(id, null);
    }
  }
});
/** The storerooms chosen, by line, for the product it was chosen for. */
const chosen = reactive(
  new Map<number, { productId: string; storeroomId: string }>(),
);
/** Where a line goes: chosen for its product, or its product's own to begin with; "" if none. */
function storeroomOf(index: number): string {
  const product = matchedProduct(index);
  if (!product) return "";
  const kept = chosen.get(index);
  if (kept?.productId === product.id) return kept.storeroomId;
  return startingStoreroom(
    ownStoreroom.get(product.id) ?? null,
    storerooms.value ?? [],
  );
}
function chooseStoreroom(index: number, storeroomId: string) {
  const product = matchedProduct(index);
  if (!product) return;
  chosen.set(index, { productId: product.id, storeroomId });
  const path = `lines.${index}.storeroomId`;
  refused.value = Object.fromEntries(
    Object.entries(refused.value).filter(([field]) => field !== path),
  );
}
/** The active storerooms, the line's product's own first, and said to be its own. */
function storeroomOptions(index: number): SelectOption[] {
  const own = ownStoreroom.get(matchedProduct(index)?.id ?? "") ?? null;
  return (storerooms.value ?? [])
    .map((s) => ({
      value: s.id,
      label:
        s.id === own ? t("documents.posting.own", { name: s.name }) : s.name,
    }))
    .sort((a, b) => Number(b.value === own) - Number(a.value === own));
}

/** Whether posting is offered now, and why not (decision 0038). */
const postState = computed(() =>
  posting({
    role: currentUser.value?.role ?? "counter",
    reasons: matching.value?.reviewReasons ?? [],
    dirty: dirty.value,
    // As saved: what's posted is the saved draft, and nothing is unsaved when it's offered.
    type:
      props.document.draft || props.document.corrected
        ? loaded.value.documentType
        : null,
  }),
);
/** The saved draft's type, for the words: "Registrar la factura". */
const savedType = computed(() =>
  loaded.value.documentType === "invoice" ? "invoice" : "delivery-note",
);
const postHintId = useId();
const confirmingPost = ref(false);
const postingNow = ref(false);

/** Asks first, once every line received has a storeroom; a line without one says so. */
function askToPost() {
  const missing = values.value.lines.flatMap((_, i) =>
    receivesAt(i) && storeroomOf(i) === "" ? [`lines.${i}.storeroomId`] : [],
  );
  if (missing.length > 0) {
    refused.value = Object.fromEntries(
      missing.map((path) => [path, "required"]),
    );
    showToast({ tone: "error", title: t("errors.cannot_post") });
    goTo(missing[0]!);
    return;
  }
  confirmingPost.value = true;
}

async function post() {
  postingNow.value = true;
  try {
    await call(endpoints.postDocument, {
      params: { id: props.document.id },
      // A line an invoice bills stays where its delivery note put it.
      body: {
        storerooms: values.value.lines.map((_, i) =>
          receivesAt(i) ? storeroomOf(i) : null,
        ),
      },
    });
    confirmingPost.value = false;
    showToast({
      tone: "success",
      title: t(`documents.posting.posted.${savedType.value}`),
    });
    emit("posted");
  } catch (caught) {
    confirmingPost.value = false;
    if (caught instanceof ApiError && caught.fields) {
      refused.value = { ...caught.fields };
    }
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
    // Something changed meanwhile: what's left, and what each line bills, as they are now.
    if (
      caught instanceof ApiError &&
      (caught.code === "review_pending" || caught.code === "already_billed")
    ) {
      void loadMatching();
    }
    if (caught instanceof ApiError && caught.code === "not_in_review") {
      emit("reload");
    }
  } finally {
    postingNow.value = false;
  }
}

/** The line whose product is being chosen, from 0; null when none is. */
const mappingLine = ref<number | null>(null);
const mappingOpen = computed({
  get: () => mappingLine.value !== null,
  set: (open) => {
    if (!open) mappingLine.value = null;
  },
});
/** A saved line, to say which it is: "T-01 · Tomate pera". */
function lineText(index: number | null): string {
  const line = index === null ? undefined : loaded.value.lines[index];
  return [line?.supplierCode, line?.description].filter(Boolean).join(" · ");
}
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
  if (/^lines\.\d+$/.test(path)) return { taken: "documents.billing.taken" };
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
      class="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5"
      aria-labelledby="left-heading"
    >
      <h3 id="left-heading" class="font-semibold">
        {{ t("documents.left") }}
      </h3>
      <UiErrorState
        v-if="loadFailed"
        :message="t('documents.review.loadFailed')"
        retryable
        @retry="retryLoading"
      />
      <UiLoadingState v-else-if="!matching || !storerooms" :lines="2" />
      <template v-else>
        <ul
          v-if="reasons.length > 0"
          class="flex list-disc flex-col gap-1 ps-5"
        >
          <li v-for="reason in reasons" :key="reason">
            {{ t(`documents.reasons.${reason}`) }}
          </li>
        </ul>
        <p v-else>{{ t("documents.nothingLeft") }}</p>
        <div class="flex flex-wrap items-center gap-3 pt-2">
          <UiButton
            :disabled="!postState.offered"
            :aria-describedby="postState.blocked ? postHintId : undefined"
            @click="askToPost"
          >
            {{ t(`documents.posting.post.${savedType}`) }}
          </UiButton>
          <p
            v-if="postState.blocked"
            :id="postHintId"
            class="text-sm text-fg-muted"
          >
            {{ t(`documents.posting.blocked.${postState.blocked}`) }}
          </p>
        </div>
      </template>
    </section>

    <DocumentSupplier
      v-if="mode === 'all' && matching"
      :document-id="document.id"
      :matching="matching"
      :read="readSupplier"
      @chosen="supplierChosen"
    />

    <PriceDifferences v-if="matching && isInvoice" :matching="matching" />

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
          <LineBilling
            v-if="lineBilling(index) !== undefined"
            :field="`lines.${index}`"
            :billing="lineBilling(index) ?? null"
            :offers="billingOffersOf(index)"
            :error="errorAt(`lines.${index}`)"
            :busy="billingNow"
            @confirm="confirmBilling(index)"
            @choose="billingLine = index"
            @receive="setBilling(index, { received: true })"
          />
          <template v-if="receivesAt(index)">
            <LineProduct
              v-if="lineMatch(index) !== undefined"
              :match="lineMatch(index) ?? null"
              v-bind="lineMapping(index)"
              @choose="mappingLine = index"
            />
            <LineStoreroom
              v-if="storeroomShown(index)"
              :field="`lines.${index}.storeroomId`"
              :options="storeroomOptions(index)"
              :error="errorAt(`lines.${index}.storeroomId`)"
              :no-price="values.lines[index]?.unitPrice === ''"
              :model-value="storeroomOf(index)"
              @update:model-value="(id) => chooseStoreroom(index, id)"
            />
          </template>
          <p
            v-if="linesMoved"
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
      :line-text="lineText(mappingLine)"
      :suggested="mappingSuggestion"
      @mapped="(next) => (matching = next)"
    />
    <BillingDialog
      v-model:open="billingOpen"
      :document-id="document.id"
      :line="(billingLine ?? 0) + 1"
      :line-text="lineText(billingLine)"
      :saving="billingNow"
      @chosen="chooseBilling"
    />
    <UiDialog
      v-model:open="confirmingPost"
      :title="
        t(`documents.posting.confirmTitle.${savedType}`, {
          number: loaded.number ?? '',
        })
      "
      :description="t(`documents.posting.confirmText.${savedType}`)"
    >
      <template #footer="{ close }">
        <UiButton variant="secondary" @click="close">
          {{ t("catalogue.cancel") }}
        </UiButton>
        <UiButton :loading="postingNow" @click="post">
          {{ t("documents.posting.confirm") }}
        </UiButton>
      </template>
    </UiDialog>
    <UnsavedDialog
      v-model:open="guard.asking.value"
      @stay="guard.stay"
      @leave="guard.leave"
    />
  </section>
</template>
