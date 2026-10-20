<script setup lang="ts">
import { Locale, type ExtractedDocument } from "@kitchen-ops/shared";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useT } from "../i18n";
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatPrice,
  formatPrintedDecimal,
} from "../i18n/format";

// A draft, read-only (#106): its header and totals, and its lines in a table. A document not in
// review shows it so, and a reviewed one shows what the model read with it (#118).
withDefaults(
  defineProps<{
    draft: ExtractedDocument;
    /** The lines table's name: "Líneas", or "Líneas leídas" next to a corrected draft. */
    linesLabel?: string;
  }>(),
  { linesLabel: undefined },
);
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));

const money = (value: string | null) =>
  value === null ? "—" : formatMoney(value, language.value);
const price = (value: string | null) =>
  value === null ? "—" : formatPrice(value, language.value);
const decimal = (value: string | null) =>
  value === null ? "—" : formatPrintedDecimal(value, language.value);
const percent = (value: string | null) =>
  value === null ? "—" : formatPercent(value, language.value);
</script>

<template>
  <div class="flex flex-col gap-4">
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
      :aria-label="linesLabel ?? t('documents.lines')"
    >
      <table class="w-full text-sm">
        <caption class="sr-only">
          {{
            linesLabel ?? t("documents.lines")
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
            v-for="(line, index) in draft.lines"
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
  </div>
</template>
