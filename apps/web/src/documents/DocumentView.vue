<script setup lang="ts">
import {
  endpoints,
  Locale,
  type Document,
  type DocumentCheckFailure,
  type SavedDraft,
} from "@kitchen-ops/shared";
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { ApiError, call } from "../api";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import { formatDateTime, formatReadingCost } from "../i18n/format";
import { currentUser } from "../session";
import { usePageTitle } from "../shell/title";
import DocumentOriginal from "./DocumentOriginal.vue";
import DocumentPosted from "./DocumentPosted.vue";
import DocumentReview from "./DocumentReview.vue";
import { editing } from "./draft-form";
import DraftReadOnly from "./DraftReadOnly.vue";
import { failureLine, inProgress } from "./list";
import { usePolling } from "./polling";
import StatusBadge from "./StatusBadge.vue";
import { documentName } from "./text";

// One document (#106): its originals, its status, which updates by itself while it's being
// read, and a failed one says why and can be read again. Once read, and in review, its draft is
// corrected next to its original (#118); otherwise the draft shows read-only, with the checks
// it failed. Its reading cost shows only to the owner: the API sends it to no one else. Once
// posted, it shows what it put in stock, read-only (#119); a reversed one and its corrected copy
// link to each other.
const props = defineProps<{ id: string }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));

const document = shallowRef<Document>();
const loading = ref(false);
const loadError = ref<MessageKey>();
const retrying = ref(false);

async function load(id: string, quiet = false) {
  if (!quiet) {
    loading.value = true;
    loadError.value = undefined;
  }
  try {
    const found = await call(endpoints.getDocument, { params: { id } });
    if (id === props.id) document.value = found;
  } catch (caught) {
    if (quiet) throw caught;
    loadError.value =
      caught instanceof ApiError
        ? errorMessageKey(caught)
        : "documents.loadFailed";
  } finally {
    if (!quiet) loading.value = false;
  }
  poller.check();
}
const poller = usePolling(
  () => load(props.id, true),
  () => document.value !== undefined && inProgress([document.value]),
);
watch(
  () => props.id,
  (id) => {
    document.value = undefined;
    void load(id);
  },
  { immediate: true },
);
/** The document again, quietly: with fresh links, or as someone else left it. */
const reload = () => void load(props.id, true).catch(() => {});

usePageTitle(() =>
  document.value?.number ? documentName(t, document.value) : undefined,
);

async function retry() {
  retrying.value = true;
  try {
    document.value = await call(endpoints.retryDocument, {
      params: { id: props.id },
    });
    showToast({ tone: "info", title: t("documents.retried") });
  } catch (caught) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
    // Someone else may have retried it already: show where it is now.
    await load(props.id, true).catch(() => {});
  } finally {
    retrying.value = false;
  }
  poller.check();
}

/** The draft as it stands: as corrected in review, or as read. */
const draft = computed(
  () => document.value?.corrected ?? document.value?.draft ?? null,
);
/** What the signed-in user may correct of it, while it's in review (spec section 6). */
const mode = computed(() =>
  document.value?.status === "ready_for_review" && currentUser.value
    ? editing(currentUser.value.role, draft.value)
    : "none",
);

/** A correction saved: the document as it is now, its header the corrected one's. */
function saved({ corrected, checkFailures }: SavedDraft) {
  if (!document.value) return;
  document.value = {
    ...document.value,
    corrected,
    checkFailures,
    type: corrected.documentType,
    number: corrected.number,
    date: corrected.issueDate,
  };
}

/** A failed check in words, with its line if it's on one: "Línea 4: el importe no cuadra…". */
function failureText(failure: DocumentCheckFailure): string {
  const check = t(`documents.checks.${failure.check}`);
  const line = failureLine(failure.path);
  return line
    ? t("documents.onLine", { line, check })
    : check.charAt(0).toUpperCase() + check.slice(1);
}
</script>

<template>
  <UiLoadingState v-if="loading" />
  <UiErrorState v-else-if="loadError" :message="t(loadError)" />
  <div
    v-else-if="document"
    :class="[
      'flex flex-col gap-8',
      mode === 'none' ? 'max-w-4xl' : 'max-w-7xl',
    ]"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <p data-testid="document-status">
          <StatusBadge
            :status="document.status"
            :reversed="document.reversal !== null"
          />
        </p>
        <p class="text-sm text-fg-muted">
          {{
            t("documents.uploadedBy", {
              name: document.uploadedBy.name,
              when: formatDateTime(document.uploadedAt, language),
            })
          }}
        </p>
      </div>
      <p v-if="document.copyOf" class="text-sm">
        {{ t("documents.posted.copyOf") }}
        <RouterLink
          :to="{ name: 'document', params: { id: document.copyOf } }"
          class="text-primary underline underline-offset-4"
        >
          {{ t("documents.posted.seeOriginal") }}
        </RouterLink>
      </p>
      <p v-if="document.copy" class="text-sm">
        <RouterLink
          :to="{ name: 'document', params: { id: document.copy } }"
          class="text-primary underline underline-offset-4"
        >
          {{ t("documents.posted.seeCopy") }}
        </RouterLink>
      </p>
      <!-- Says each new status to a screen reader as it changes by itself. -->
      <p class="sr-only" aria-live="polite">
        {{
          t("documents.statusNow", {
            status: t(`documents.statuses.${document.status}`),
          })
        }}
      </p>
      <UiAlert
        v-if="document.status === 'failed'"
        tone="error"
        :title="t('documents.failedTitle')"
      >
        <div class="flex flex-col items-start gap-3">
          <p v-if="document.failureReason">
            {{ t(`documents.failures.${document.failureReason}`) }}
          </p>
          <UiButton variant="secondary" :loading="retrying" @click="retry">
            {{ t("documents.retry") }}
          </UiButton>
        </div>
      </UiAlert>
      <dl v-if="document.costMicroUsd !== undefined" class="flex gap-2 text-sm">
        <dt class="text-fg-muted">{{ t("documents.cost") }}</dt>
        <dd class="tabular">
          {{ formatReadingCost(document.costMicroUsd, language) }}
        </dd>
      </dl>
    </div>

    <!-- In review on a desktop, the original stays beside the draft while it scrolls. -->
    <div
      :class="
        mode === 'none'
          ? 'flex flex-col gap-8'
          : 'grid gap-8 lg:grid-cols-2 lg:items-start'
      "
    >
      <div
        :class="
          mode === 'none'
            ? ''
            : 'lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-auto'
        "
      >
        <DocumentOriginal :document="document" @expired="reload" />
      </div>

      <DocumentReview
        v-if="mode !== 'none'"
        :key="document.id"
        :document="document"
        :mode="mode"
        @saved="saved"
        @reload="reload"
        @posted="reload"
      />
      <DocumentPosted
        v-else-if="document.status === 'posted'"
        :document="document"
        @changed="reload"
      />
      <section
        v-else
        class="flex flex-col gap-4"
        aria-labelledby="read-heading"
      >
        <h2 id="read-heading" class="text-lg font-semibold">
          {{ t("documents.readHeading") }}
        </h2>
        <p
          v-if="document.status === 'queued' || document.status === 'reading'"
          class="text-fg-muted"
        >
          {{ t("documents.beingRead") }}
        </p>
        <UiAlert
          v-else-if="document.status === 'ready_for_review' && !draft"
          tone="info"
        >
          {{ t("documents.noDraft") }}
        </UiAlert>

        <template v-if="draft">
          <DraftReadOnly :draft="draft" />
          <section class="flex flex-col gap-2" aria-labelledby="checks-heading">
            <h3 id="checks-heading" class="font-semibold">
              {{ t("documents.checksHeading") }}
            </h3>
            <ul
              v-if="document.checkFailures.length > 0"
              class="flex list-disc flex-col gap-1 ps-5"
            >
              <li
                v-for="(failure, index) in document.checkFailures"
                :key="index"
              >
                {{ failureText(failure) }}
              </li>
            </ul>
            <p v-else>{{ t("documents.allPassed") }}</p>
          </section>
        </template>
      </section>
    </div>
  </div>
</template>
