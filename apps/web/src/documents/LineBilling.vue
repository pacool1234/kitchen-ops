<script setup lang="ts">
import { Locale, type LineBilling } from "@kitchen-ops/shared";
import { computed, useId } from "vue";
import { useI18n } from "vue-i18n";
import UiButton from "../components/ui/UiButton.vue";
import { useT } from "../i18n";
import {
  formatDate,
  formatMoney,
  formatPrintedDecimal,
  formatQuantity,
  formatUnitCost,
} from "../i18n/format";
import type { BillingBlock } from "./billing-state";

// What an invoice's line bills, in review (#120, decision 0041): the delivery-note line
// suggested or confirmed for it, with its price now, the invoice's and the difference; or that
// it's received with the invoice; or nothing yet. Office and the owner confirm it, choose
// another, or receive the line with the invoice; a choice waits for the supplier and for the
// corrections to be saved, and says which.
const props = defineProps<{
  /** Its path in the draft, for the API's refusal and the checks' summary: "lines.1". */
  field: string;
  billing: LineBilling | null;
  offers: {
    confirm: boolean;
    choose: boolean;
    receive: boolean;
    blocked?: BillingBlock;
  };
  error?: string;
  busy: boolean;
}>();
const emit = defineEmits<{ confirm: []; choose: []; receive: [] }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const hintId = useId();

const billed = computed(() =>
  props.billing && props.billing.by !== "received" ? props.billing : undefined,
);

/** "Factura el albarán ALB-0001 del 21/10/2026, línea 2 · 2 garrafa". */
const billedText = computed(() => {
  const b = billed.value;
  if (!b) return "";
  const { deliveryNote, position, quantity, unit } = b.deliveryNoteLine;
  return t(`documents.billing.${b.by}`, {
    number: deliveryNote.number ?? t("documents.billing.noNumber"),
    date: formatDate(deliveryNote.date, language.value),
    line: position,
    quantity: `${formatPrintedDecimal(quantity, language.value)} ${unit}`,
  });
});

/** Its price now, the invoice's and the difference; or why they can't be compared. */
const pricesText = computed(() => {
  const b = billed.value;
  if (!b) return "";
  const { product, unitCost, baseQuantity } = b.deliveryNoteLine;
  if (!b.quantityMatches) {
    return t("documents.billing.quantityDiffers", {
      received: formatQuantity(baseQuantity, product.baseUnit, language.value),
    });
  }
  if (b.invoiceUnitCost === null || b.difference === null) {
    return t("documents.billing.noPrice");
  }
  return t("documents.billing.prices", {
    before: formatUnitCost(unitCost, product.baseUnit, language.value),
    after: formatUnitCost(b.invoiceUnitCost, product.baseUnit, language.value),
    difference: formatMoney(b.difference, language.value),
  });
});
</script>

<template>
  <div
    class="flex flex-col gap-2 border-t border-line pt-3 text-sm"
    :data-field="field"
    :tabindex="error ? -1 : undefined"
  >
    <template v-if="billed">
      <p class="font-medium">{{ billedText }}</p>
      <p
        class="tabular"
        :class="billed.quantityMatches ? 'text-fg-muted' : 'text-danger'"
      >
        {{ pricesText }}
      </p>
    </template>
    <p v-else-if="billing?.by === 'received'" class="font-medium">
      {{ t("documents.billing.received") }}
    </p>
    <p v-else>{{ t("documents.billing.none") }}</p>
    <p v-if="error" class="text-danger">{{ error }}</p>

    <div
      v-if="offers.confirm || offers.choose || offers.receive || offers.blocked"
      class="flex flex-wrap items-center gap-2"
    >
      <UiButton
        v-if="offers.confirm"
        size="sm"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ t("documents.billing.confirm") }}
      </UiButton>
      <UiButton
        v-if="offers.choose || offers.blocked"
        size="sm"
        variant="secondary"
        :disabled="busy || !offers.choose"
        :aria-describedby="offers.blocked ? hintId : undefined"
        @click="emit('choose')"
      >
        {{
          t(billed ? "documents.billing.choose" : "documents.billing.chooseOne")
        }}
      </UiButton>
      <UiButton
        v-if="offers.receive"
        size="sm"
        variant="secondary"
        :disabled="busy"
        @click="emit('receive')"
      >
        {{ t("documents.billing.receive") }}
      </UiButton>
      <p v-if="offers.blocked" :id="hintId" class="text-fg-muted">
        {{ t(`documents.billing.blocked.${offers.blocked}`) }}
      </p>
    </div>
  </div>
</template>
