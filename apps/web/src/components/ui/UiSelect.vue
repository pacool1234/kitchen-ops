<script setup lang="ts">
import { Check, ChevronDown } from "lucide-vue-next";
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";
import { useT } from "../../i18n";
import UiFieldShell from "./UiFieldShell.vue";
import type { SelectOption } from "./options";
import { control, option, popover } from "./styles";

// A choice from a short list (#85), on Reka UI's Select: arrow keys move, typing jumps to
// an option, Escape closes. For a long list, use Combobox, which searches.
defineProps<{
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
</script>

<template>
  <UiFieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="label"
    :hint="hint"
    :error="error"
    :optional="optional"
  >
    <SelectRoot v-model="model" :disabled="disabled" :required="!optional">
      <SelectTrigger
        :id="id"
        :class="[control, 'flex items-center justify-between gap-2 text-start']"
        :aria-describedby="describedBy"
        :aria-invalid="invalid || undefined"
      >
        <SelectValue
          :placeholder="placeholder ?? t('ui.select.placeholder')"
          class="truncate data-placeholder:text-fg-muted"
        />
        <ChevronDown class="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
      </SelectTrigger>
      <SelectPortal>
        <SelectContent
          position="popper"
          :side-offset="4"
          :class="[
            popover,
            'max-h-(--reka-select-content-available-height) min-w-(--reka-select-trigger-width)',
          ]"
        >
          <SelectViewport>
            <SelectItem
              v-for="item in options"
              :key="item.value"
              :value="item.value"
              :disabled="item.disabled"
              :class="option"
            >
              <SelectItemIndicator class="absolute start-2 flex items-center">
                <Check class="size-4" aria-hidden="true" />
              </SelectItemIndicator>
              <SelectItemText>{{ item.label }}</SelectItemText>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </UiFieldShell>
</template>
