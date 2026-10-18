<script setup lang="ts">
import { Check, ChevronDown, Search } from "lucide-vue-next";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";
import { computed, ref } from "vue";
import { useT } from "../../i18n";
import UiFieldShell from "./UiFieldShell.vue";
import type { SelectOption } from "./options";
import { matchesSearch } from "./search";
import { control, option, popover } from "./styles";

// A choice from a long list, found by typing (#85), on Reka UI's Combobox. The search ignores
// capitals and accents ("limon" finds "Limón"); Reka's own filter doesn't.
const props = defineProps<{
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  error?: string;
  optional?: boolean;
  placeholder?: string;
  disabled?: boolean;
}>();
const model = defineModel<string>();
const t = useT();
const search = ref("");

const matching = computed(() =>
  props.options.filter((o) => matchesSearch(o.label, search.value)),
);
const labelOf = (value: unknown) =>
  props.options.find((o) => o.value === value)?.label ?? "";

// Closed, the next search starts from every option again.
function onOpen(open: boolean) {
  if (!open) search.value = "";
}
</script>

<template>
  <UiFieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="label"
    :hint="hint"
    :error="error"
    :optional="optional"
  >
    <ComboboxRoot
      v-model="model"
      :ignore-filter="true"
      :disabled="disabled"
      :required="!optional"
      @update:open="onOpen"
    >
      <!-- The focus ring goes round the whole field; data-focus-frame tells the tests. -->
      <ComboboxAnchor
        data-focus-frame
        :class="[
          control,
          'flex items-center gap-2 pe-1',
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
        ]"
        :aria-invalid="invalid || undefined"
      >
        <Search class="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <ComboboxInput
          :id="id"
          v-model="search"
          :display-value="labelOf"
          :placeholder="placeholder ?? t('ui.combobox.placeholder')"
          :aria-describedby="describedBy"
          :aria-invalid="invalid || undefined"
          class="h-full min-w-0 flex-1 bg-surface text-fg outline-none placeholder:text-fg-muted"
        />
        <ComboboxTrigger
          :aria-label="t('ui.combobox.toggle')"
          class="flex size-9 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-muted"
        >
          <ChevronDown class="size-4" aria-hidden="true" />
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxPortal>
        <ComboboxContent
          position="popper"
          :side-offset="4"
          :class="[popover, 'max-h-72 w-(--reka-combobox-trigger-width)']"
        >
          <ComboboxViewport>
            <p
              v-if="matching.length === 0"
              class="px-3 py-2 text-sm text-fg-muted"
              role="status"
            >
              {{ t("ui.combobox.empty") }}
            </p>
            <ComboboxItem
              v-for="item in matching"
              :key="item.value"
              :value="item.value"
              :disabled="item.disabled"
              :class="option"
            >
              <ComboboxItemIndicator class="absolute start-2 flex items-center">
                <Check class="size-4" aria-hidden="true" />
              </ComboboxItemIndicator>
              {{ item.label }}
            </ComboboxItem>
          </ComboboxViewport>
        </ComboboxContent>
      </ComboboxPortal>
    </ComboboxRoot>
  </UiFieldShell>
</template>
