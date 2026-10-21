<script setup lang="ts">
import { Locale, type DocumentMatching } from "@kitchen-ops/shared";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useT } from "../i18n";
import { formatMoney, formatUnitCost } from "../i18n/format";

// An invoice's price differences, line by line (#120, decision 0041 point 5): each billed
// delivery-note line's price now, the invoice's, and the difference in euros; and the total,
// what the invoice changes its delivery notes' value by. A suggested line counts as it stands.
const props = defineProps<{ matching: DocumentMatching }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));

const rows = computed(() =>
  props.matching.lines.flatMap(({ line, billing }) => {
    if (!billing || billing.by === "received") return [];
    const { deliveryNote, product, unitCost } = billing.deliveryNoteLine;
    const cost = (value: string | null) =>
      value === null
        ? "—"
        : formatUnitCost(value, product.baseUnit, language.value);
    return [
      {
        line,
        product: product.name,
        note: deliveryNote.number ?? t("documents.billing.noNumber"),
        before: cost(unitCost),
        after: cost(billing.invoiceUnitCost),
        difference:
          billing.difference === null
            ? "—"
            : formatMoney(billing.difference, language.value),
      },
    ];
  }),
);
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"
    aria-labelledby="differences-heading"
  >
    <h3 id="differences-heading" class="font-semibold">
      {{ t("documents.billing.differences") }}
    </h3>
    <p v-if="rows.length === 0" class="text-fg-muted">
      {{ t("documents.billing.noDifferences") }}
    </p>
    <!-- Wider than a phone: it scrolls sideways, and a keyboard can scroll it too. -->
    <div
      v-else
      class="overflow-x-auto rounded-lg border border-line"
      tabindex="0"
      role="region"
      :aria-label="t('documents.billing.differencesCaption')"
    >
      <table class="w-full text-sm">
        <caption class="sr-only">
          {{
            t("documents.billing.differencesCaption")
          }}
        </caption>
        <thead class="bg-surface-muted">
          <tr>
            <th scope="col" class="px-3 py-2 text-start">
              {{ t("documents.billing.line") }}
            </th>
            <th scope="col" class="px-3 py-2 text-start">
              {{ t("documents.billing.product") }}
            </th>
            <th scope="col" class="px-3 py-2 text-start">
              {{ t("documents.billing.deliveryNote") }}
            </th>
            <th scope="col" class="px-3 py-2 text-end">
              {{ t("documents.billing.before") }}
            </th>
            <th scope="col" class="px-3 py-2 text-end">
              {{ t("documents.billing.after") }}
            </th>
            <th scope="col" class="px-3 py-2 text-end">
              {{ t("documents.billing.difference") }}
            </th>
          </tr>
        </thead>
        <tbody class="tabular">
          <tr v-for="row in rows" :key="row.line" class="border-t border-line">
            <td class="px-3 py-2">{{ row.line }}</td>
            <td class="px-3 py-2">{{ row.product }}</td>
            <td class="px-3 py-2">{{ row.note }}</td>
            <td class="px-3 py-2 text-end">{{ row.before }}</td>
            <td class="px-3 py-2 text-end">{{ row.after }}</td>
            <td class="px-3 py-2 text-end">{{ row.difference }}</td>
          </tr>
        </tbody>
        <tfoot class="tabular">
          <tr class="border-t border-line-strong font-semibold">
            <th scope="row" colspan="5" class="px-3 py-2 text-start">
              {{ t("documents.billing.total") }}
            </th>
            <td class="px-3 py-2 text-end">
              {{ formatMoney(matching.difference ?? "0.00", language) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>
