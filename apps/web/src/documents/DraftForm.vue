<script setup lang="ts">
import { EXTRACTED_DOCUMENT_TYPES, Locale } from "@kitchen-ops/shared";
import { Plus, Trash2 } from "lucide-vue-next";
import { computed, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import UiButton from "../components/ui/UiButton.vue";
import UiNumberField from "../components/ui/UiNumberField.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiSwitch from "../components/ui/UiSwitch.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { useT } from "../i18n";
import { formatMoney, formatPercent, formatPrice } from "../i18n/format";
import { emptyLine, emptyVatRow, type DraftValues } from "./draft-form";

// A draft to correct in review (#118): the header, the amounts and every line, each field named
// by its path in the draft (`data-field`), so a check's failure shows on it and the summary can
// take you there. A counter user gets the lines with only their quantity to change; the rest is
// shown as text (spec section 6, decision 0037).
const props = defineProps<{
  mode: "all" | "quantities";
  /** The message to show on a field or block, by its path. */
  errorAt: (path: string) => string | undefined;
}>();
const values = defineModel<DraftValues>({ required: true });
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));

const typeOptions = computed(() =>
  EXTRACTED_DOCUMENT_TYPES.map((type) => ({
    value: type,
    label: t(`documents.types.${type}`),
  })),
);

/** Focus on a field by its path, once it's on the page. */
async function focusField(path: string) {
  await nextTick();
  document.querySelector<HTMLElement>(`[data-field="${path}"]`)?.focus();
}

function addLine() {
  values.value.lines.push(emptyLine());
  void focusField(`lines.${values.value.lines.length - 1}.description`);
}
function removeLine(index: number) {
  values.value.lines.splice(index, 1);
}
function addVat() {
  values.value.totals.vat.push(emptyVatRow());
  void focusField(`totals.vat.${values.value.totals.vat.length - 1}.rate`);
}
function removeVat(index: number) {
  values.value.totals.vat.splice(index, 1);
}

/** A value shown as text, for a counter user: as printed, or a dash. */
const shown = (value: string) => value || "—";
const money = (value: string) =>
  value ? formatMoney(value, language.value) : "—";
const price = (value: string) =>
  value ? formatPrice(value, language.value) : "—";
const percent = (value: string) =>
  value ? formatPercent(value, language.value) : "—";
const quantities = computed(() => props.mode === "quantities");
/** An invoice needs its amounts (the missing-value check); a delivery note may have none. */
const invoice = computed(() => values.value.documentType === "invoice");
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- The header: to change, or as read for a counter user. -->
    <fieldset
      class="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <legend class="px-1 font-semibold">
        {{ t("documents.review.header") }}
      </legend>
      <dl
        v-if="quantities"
        class="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]"
      >
        <dt class="font-medium text-fg-muted">{{ t("documents.document") }}</dt>
        <dd>{{ t(`documents.types.${values.documentType}`) }}</dd>
        <dt class="font-medium text-fg-muted">{{ t("documents.supplier") }}</dt>
        <dd>{{ shown(values.supplier.name) }}</dd>
        <dt class="font-medium text-fg-muted">{{ t("documents.taxId") }}</dt>
        <dd class="tabular">{{ shown(values.supplier.taxId) }}</dd>
        <dt class="font-medium text-fg-muted">{{ t("documents.number") }}</dt>
        <dd class="tabular">{{ shown(values.number) }}</dd>
        <dt class="font-medium text-fg-muted">{{ t("documents.date") }}</dt>
        <dd class="tabular">{{ shown(values.issueDate) }}</dd>
      </dl>
      <div v-else class="grid gap-4 sm:grid-cols-2">
        <div data-field="documentType">
          <UiSelect
            v-model="values.documentType"
            :label="t('documents.review.type')"
            :options="typeOptions"
            :error="errorAt('documentType')"
          />
        </div>
        <UiTextField
          v-model="values.number"
          :label="t('documents.number')"
          data-field="number"
          :error="errorAt('number')"
        />
        <UiTextField
          v-model="values.supplier.name"
          :label="t('documents.review.supplierName')"
          optional
          data-field="supplier.name"
          :error="errorAt('supplier.name')"
        />
        <UiTextField
          v-model="values.supplier.taxId"
          :label="t('documents.taxId')"
          data-field="supplier.taxId"
          :error="errorAt('supplier.taxId')"
        />
        <UiTextField
          v-model="values.issueDate"
          :label="t('documents.date')"
          :hint="t('documents.review.dateHint')"
          inputmode="numeric"
          data-field="issueDate"
          :error="errorAt('issueDate')"
        />
      </div>
    </fieldset>

    <!-- The amounts: net, VAT by rate and total, or none for a delivery note without prices. -->
    <fieldset
      class="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
      data-field="totals"
      tabindex="-1"
    >
      <legend class="px-1 font-semibold">
        {{ t("documents.review.totals") }}
      </legend>
      <p v-if="errorAt('totals')" class="text-sm font-medium text-danger">
        {{ errorAt("totals") }}
      </p>
      <template v-if="quantities">
        <dl
          v-if="values.hasTotals"
          class="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]"
        >
          <dt class="font-medium text-fg-muted">{{ t("documents.net") }}</dt>
          <dd class="tabular">{{ money(values.totals.net) }}</dd>
          <template v-for="(row, index) in values.totals.vat" :key="index">
            <dt class="font-medium text-fg-muted">
              {{ t("documents.vat", { rate: percent(row.rate) }) }}
            </dt>
            <dd class="tabular">{{ money(row.amount) }}</dd>
          </template>
          <dt class="font-medium text-fg-muted">{{ t("documents.total") }}</dt>
          <dd class="tabular font-semibold">
            {{ money(values.totals.total) }}
          </dd>
        </dl>
        <p v-else>{{ t("documents.noTotals") }}</p>
      </template>
      <template v-else>
        <UiSwitch
          v-model="values.hasTotals"
          :label="t('documents.review.hasTotals')"
        />
        <template v-if="values.hasTotals">
          <UiNumberField
            v-model="values.totals.net"
            :label="t('documents.net')"
            unit="€"
            :optional="!invoice"
            :max-decimals="2"
            allow-negative
            data-field="totals.net"
            :error="errorAt('totals.net')"
          />
          <div
            class="flex flex-col gap-3"
            data-field="totals.vat"
            tabindex="-1"
          >
            <p
              v-if="errorAt('totals.vat')"
              class="text-sm font-medium text-danger"
            >
              {{ errorAt("totals.vat") }}
            </p>
            <fieldset
              v-for="(row, index) in values.totals.vat"
              :key="index"
              class="flex flex-col gap-3 rounded-md border border-line p-4"
            >
              <legend class="px-1 font-medium">
                {{ t("documents.review.vatRow", { n: index + 1 }) }}
              </legend>
              <div class="grid gap-3 sm:grid-cols-3">
                <UiNumberField
                  v-model="row.rate"
                  :label="t('documents.review.vatRate')"
                  unit="%"
                  :optional="!invoice"
                  :max-decimals="2"
                  :data-field="`totals.vat.${index}.rate`"
                  :error="errorAt(`totals.vat.${index}.rate`)"
                />
                <UiNumberField
                  v-model="row.base"
                  :label="t('documents.review.vatBase')"
                  unit="€"
                  :optional="!invoice"
                  :max-decimals="2"
                  allow-negative
                  :data-field="`totals.vat.${index}.base`"
                  :error="errorAt(`totals.vat.${index}.base`)"
                />
                <UiNumberField
                  v-model="row.amount"
                  :label="t('documents.review.vatAmount')"
                  unit="€"
                  :optional="!invoice"
                  :max-decimals="2"
                  allow-negative
                  :data-field="`totals.vat.${index}.amount`"
                  :error="errorAt(`totals.vat.${index}.amount`)"
                />
              </div>
              <div>
                <UiButton
                  variant="ghost"
                  size="sm"
                  :icon="Trash2"
                  @click="removeVat(index)"
                >
                  {{ t("documents.review.removeVat", { n: index + 1 }) }}
                </UiButton>
              </div>
            </fieldset>
            <div>
              <UiButton
                variant="secondary"
                size="sm"
                :icon="Plus"
                @click="addVat"
              >
                {{ t("documents.review.addVat") }}
              </UiButton>
            </div>
          </div>
          <UiNumberField
            v-model="values.totals.total"
            :label="t('documents.total')"
            unit="€"
            :optional="!invoice"
            :max-decimals="2"
            allow-negative
            data-field="totals.total"
            :error="errorAt('totals.total')"
          />
        </template>
      </template>
    </fieldset>

    <!-- The lines, one card each. -->
    <section class="flex flex-col gap-4" aria-labelledby="lines-heading">
      <h3 id="lines-heading" class="font-semibold">
        {{ t("documents.lines") }}
      </h3>
      <fieldset
        v-for="(line, index) in values.lines"
        :key="index"
        class="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <legend class="px-1 font-medium">
          {{ t("documents.review.line", { n: index + 1 }) }}
        </legend>
        <template v-if="quantities">
          <p>
            <span class="font-medium">{{ shown(line.description) }}</span>
            <span v-if="line.supplierCode" class="text-fg-muted">
              · {{ line.supplierCode }}
            </span>
          </p>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt class="text-fg-muted">{{ t("documents.unit") }}</dt>
            <dd>{{ shown(line.unit) }}</dd>
            <dt class="text-fg-muted">{{ t("documents.unitPrice") }}</dt>
            <dd class="tabular">{{ price(line.unitPrice) }}</dd>
            <dt class="text-fg-muted">{{ t("documents.lineTotal") }}</dt>
            <dd class="tabular">{{ money(line.lineTotal) }}</dd>
          </dl>
          <UiNumberField
            v-model="line.quantity"
            :label="t('documents.quantity')"
            :unit="line.unit || undefined"
            :max-decimals="6"
            allow-negative
            :data-field="`lines.${index}.quantity`"
            :error="errorAt(`lines.${index}.quantity`)"
          />
        </template>
        <template v-else>
          <div class="grid gap-3 sm:grid-cols-4">
            <UiTextField
              v-model="line.supplierCode"
              :label="t('documents.code')"
              optional
              :data-field="`lines.${index}.supplierCode`"
              :error="errorAt(`lines.${index}.supplierCode`)"
            />
            <div class="sm:col-span-3">
              <UiTextField
                v-model="line.description"
                :label="t('documents.lineDescription')"
                :data-field="`lines.${index}.description`"
                :error="errorAt(`lines.${index}.description`)"
              />
            </div>
            <UiNumberField
              v-model="line.quantity"
              :label="t('documents.quantity')"
              :max-decimals="6"
              allow-negative
              :data-field="`lines.${index}.quantity`"
              :error="errorAt(`lines.${index}.quantity`)"
            />
            <UiTextField
              v-model="line.unit"
              :label="t('documents.unit')"
              :data-field="`lines.${index}.unit`"
              :error="errorAt(`lines.${index}.unit`)"
            />
            <UiNumberField
              v-model="line.unitPrice"
              :label="t('documents.unitPrice')"
              unit="€"
              :optional="!invoice"
              :max-decimals="6"
              allow-negative
              :data-field="`lines.${index}.unitPrice`"
              :error="errorAt(`lines.${index}.unitPrice`)"
            />
            <UiNumberField
              v-model="line.discountPercent"
              :label="t('documents.discount')"
              unit="%"
              optional
              :max-decimals="2"
              :data-field="`lines.${index}.discountPercent`"
              :error="errorAt(`lines.${index}.discountPercent`)"
            />
            <UiNumberField
              v-model="line.vatRate"
              :label="t('documents.vatRate')"
              unit="%"
              :optional="!invoice"
              :max-decimals="2"
              :data-field="`lines.${index}.vatRate`"
              :error="errorAt(`lines.${index}.vatRate`)"
            />
            <UiNumberField
              v-model="line.lineTotal"
              :label="t('documents.lineTotal')"
              unit="€"
              :optional="!invoice"
              :max-decimals="2"
              allow-negative
              :data-field="`lines.${index}.lineTotal`"
              :error="errorAt(`lines.${index}.lineTotal`)"
            />
          </div>
          <div>
            <UiButton
              variant="ghost"
              size="sm"
              :icon="Trash2"
              :disabled="values.lines.length === 1"
              @click="removeLine(index)"
            >
              {{ t("documents.review.removeLine", { n: index + 1 }) }}
            </UiButton>
          </div>
          <!-- What the page adds to each line: its product (#117). -->
          <slot name="line" :index="index" />
        </template>
      </fieldset>
      <div v-if="!quantities">
        <UiButton variant="secondary" :icon="Plus" @click="addLine">
          {{ t("documents.review.addLine") }}
        </UiButton>
      </div>
    </section>
  </div>
</template>
