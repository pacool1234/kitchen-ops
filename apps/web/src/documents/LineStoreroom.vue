<script setup lang="ts">
import UiSelect from "../components/ui/UiSelect.vue";
import type { SelectOption } from "../components/ui/options";
import { useT } from "../i18n";

// Where a line is received when the document is posted (#119, decision 0033): its product's
// own storeroom to begin with, or another one chosen. A line without a price says it goes in at
// €0 until the invoice corrects it (decision 0038).
defineProps<{
  /** Its path in the draft, for the errors and the checks' summary: "lines.1.storeroomId". */
  field: string;
  options: readonly SelectOption[];
  error?: string;
  noPrice: boolean;
}>();
const storeroom = defineModel<string>({ required: true });
const t = useT();
</script>

<template>
  <div
    class="flex flex-col gap-2 border-t border-line pt-3 text-sm"
    :data-field="field"
  >
    <UiSelect
      v-model="storeroom"
      :label="t('documents.posting.storeroom')"
      :options="options"
      :placeholder="t('documents.posting.chooseStoreroom')"
      :error="error"
    />
    <p v-if="noPrice" class="text-fg-muted">
      {{ t("documents.posting.noPrice") }}
    </p>
  </div>
</template>
