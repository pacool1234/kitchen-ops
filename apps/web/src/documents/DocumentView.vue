<script setup lang="ts">
import {
  endpoints,
  Locale,
  type Document,
  type DocumentCheckFailure,
  type DocumentFile,
} from "@kitchen-ops/shared";
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, call } from "../api";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPrice,
  formatPrintedDecimal,
  formatReadingCost,
} from "../i18n/format";
import { usePageTitle } from "../shell/title";
import { failureLine, inProgress } from "./list";
import { usePolling } from "./polling";
import StatusBadge from "./StatusBadge.vue";
import { documentName } from "./text";

// One document (#106): its originals, its status, which updates by itself while it's being
// read, and once read, its draft and the checks it failed, read-only. A failed one says why
// and can be read again. Its reading cost shows only to the owner: the API sends it to no one
// else. Reviewing and posting it are M7's.
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

/**
 * A photo that won't load, most likely because its link has expired (they last 5 minutes):
 * the document again, with fresh links. Only for an expired link, so a broken file can't loop.
 */
function photoFailed(file: DocumentFile) {
  if (Date.parse(file.urlExpiresAt) - Date.now() < 30_000) {
    void load(props.id, true).catch(() => {});
  }
}

const photos = computed(
  () => document.value?.files.filter((f) => f.kind === "image") ?? [],
);
const draft = computed(() => document.value?.draft ?? null);
const lines = computed(() => draft.value?.lines ?? []);

const money = (value: string | null) =>
  value === null ? "—" : formatMoney(value, language.value);
const price = (value: string | null) =>
  value === null ? "—" : formatPrice(value, language.value);
const decimal = (value: string | null) =>
  value === null ? "—" : formatPrintedDecimal(value, language.value);
const percent = (value: string | null) =>
  value === null ? "—" : formatPercent(value, language.value);

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
  <div v-else-if="document" class="flex max-w-4xl flex-col gap-8">
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <p data-testid="document-status">
          <StatusBadge :status="document.status" />
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

    <section class="flex flex-col gap-3" aria-labelledby="original-heading">
      <h2 id="original-heading" class="text-lg font-semibold">
        {{ t("documents.original") }}
      </h2>
      <ol
        v-if="photos.length > 0"
        class="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        <li v-for="(file, index) in photos" :key="file.id">
          <a :href="file.url" target="_blank" rel="noopener">
            <img
              :src="file.url"
              :alt="
                t('documents.photoOf', { n: index + 1, count: photos.length })
              "
              class="w-full rounded-md border border-line bg-surface-muted"
              @error="photoFailed(file)"
            />
          </a>
        </li>
      </ol>
      <ul v-else class="flex flex-col gap-2">
        <li v-for="file in document.files" :key="file.id">
          <a
            :href="file.url"
            target="_blank"
            rel="noopener"
            class="font-medium text-primary underline underline-offset-4"
          >
            {{
              t(file.kind === "xml" ? "documents.openXml" : "documents.openPdf")
            }}
          </a>
        </li>
      </ul>
    </section>

    <section class="flex flex-col gap-4" aria-labelledby="read-heading">
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
        <dl
          class="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[12rem_1fr]"
        >
          <dt class="font-medium text-fg-muted">
            {{ t("documents.document") }}
          </dt>
          <dd>{{ t(`documents.types.${draft.documentType}`) }}</dd>
          <dt class="font-medium text-fg-muted">
            {{ t("documents.supplier") }}
          </dt>
          <dd>{{ draft.supplier.name ?? "—" }}</dd>
          <dt class="font-medium text-fg-muted">{{ t("documents.taxId") }}</dt>
          <dd class="tabular">{{ draft.supplier.taxId ?? "—" }}</dd>
          <dt class="font-medium text-fg-muted">{{ t("documents.number") }}</dt>
          <dd class="tabular">{{ draft.number ?? "—" }}</dd>
          <dt class="font-medium text-fg-muted">{{ t("documents.date") }}</dt>
          <dd class="tabular">
            {{ draft.issueDate ? formatDate(draft.issueDate, language) : "—" }}
          </dd>
          <template v-if="draft.totals">
            <dt class="font-medium text-fg-muted">{{ t("documents.net") }}</dt>
            <dd class="tabular">{{ money(draft.totals.net) }}</dd>
            <template v-for="(vat, index) in draft.totals.vat" :key="index">
              <dt class="font-medium text-fg-muted">
                {{ t("documents.vat", { rate: percent(vat.rate) }) }}
              </dt>
              <dd class="tabular">{{ money(vat.amount) }}</dd>
            </template>
            <dt class="font-medium text-fg-muted">
              {{ t("documents.total") }}
            </dt>
            <dd class="tabular font-semibold">
              {{ money(draft.totals.total) }}
            </dd>
          </template>
          <template v-else>
            <dt class="font-medium text-fg-muted">
              {{ t("documents.total") }}
            </dt>
            <dd>{{ t("documents.noTotals") }}</dd>
          </template>
        </dl>

        <!-- Wider than a phone: it scrolls sideways, and a keyboard can scroll it too. -->
        <div
          class="overflow-x-auto rounded-lg border border-line"
          tabindex="0"
          role="region"
          :aria-label="t('documents.lines')"
        >
          <table class="w-full text-sm">
            <caption class="sr-only">
              {{
                t("documents.lines")
              }}
            </caption>
            <thead class="bg-surface-muted text-start">
              <tr>
                <th scope="col" class="px-3 py-2 text-start">
                  {{ t("documents.code") }}
                </th>
                <th scope="col" class="px-3 py-2 text-start">
                  {{ t("documents.lineDescription") }}
                </th>
                <th scope="col" class="px-3 py-2 text-end">
                  {{ t("documents.quantity") }}
                </th>
                <th scope="col" class="px-3 py-2 text-start">
                  {{ t("documents.unit") }}
                </th>
                <th scope="col" class="px-3 py-2 text-end">
                  {{ t("documents.unitPrice") }}
                </th>
                <th scope="col" class="px-3 py-2 text-end">
                  {{ t("documents.discount") }}
                </th>
                <th scope="col" class="px-3 py-2 text-end">
                  {{ t("documents.vatRate") }}
                </th>
                <th scope="col" class="px-3 py-2 text-end">
                  {{ t("documents.lineTotal") }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(line, index) in lines"
                :key="index"
                class="border-t border-line"
              >
                <td class="px-3 py-2">{{ line.supplierCode ?? "—" }}</td>
                <td class="px-3 py-2">{{ line.description ?? "—" }}</td>
                <td class="px-3 py-2 text-end">{{ decimal(line.quantity) }}</td>
                <td class="px-3 py-2">{{ line.unit ?? "—" }}</td>
                <td class="px-3 py-2 text-end">{{ price(line.unitPrice) }}</td>
                <td class="px-3 py-2 text-end">
                  {{ percent(line.discountPercent) }}
                </td>
                <td class="px-3 py-2 text-end">{{ percent(line.vatRate) }}</td>
                <td class="px-3 py-2 text-end">{{ money(line.lineTotal) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <section class="flex flex-col gap-2" aria-labelledby="checks-heading">
          <h3 id="checks-heading" class="font-semibold">
            {{ t("documents.checksHeading") }}
          </h3>
          <ul
            v-if="document.checkFailures.length > 0"
            class="flex list-disc flex-col gap-1 ps-5"
          >
            <li v-for="(failure, index) in document.checkFailures" :key="index">
              {{ failureText(failure) }}
            </li>
          </ul>
          <p v-else>{{ t("documents.allPassed") }}</p>
        </section>
      </template>
    </section>
  </div>
</template>
