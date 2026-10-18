<script setup lang="ts">
import { Check, Minus } from "lucide-vue-next";
import { CheckboxIndicator, CheckboxRoot } from "reka-ui";
import { useId } from "vue";

// A checkbox with its label beside it (#85), on Reka UI. Space toggles it. "indeterminate"
// shows a dash, for a box that stands for a group only partly checked.
const props = defineProps<{
  label: string;
  hint?: string;
  disabled?: boolean;
}>();
const model = defineModel<boolean | "indeterminate">({ default: false });
const id = useId();
const hintId = `${id}-hint`;
</script>

<template>
  <div class="flex items-start gap-3">
    <CheckboxRoot
      :id="id"
      v-model="model"
      :disabled="disabled"
      :aria-describedby="props.hint ? hintId : undefined"
      class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm border-2 border-line-strong bg-surface text-on-primary data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-60"
    >
      <CheckboxIndicator>
        <Minus
          v-if="model === 'indeterminate'"
          class="size-3.5"
          :stroke-width="3"
          aria-hidden="true"
        />
        <Check v-else class="size-3.5" :stroke-width="3" aria-hidden="true" />
      </CheckboxIndicator>
    </CheckboxRoot>
    <div class="flex flex-col gap-0.5">
      <label :for="id" class="font-medium text-fg">{{ label }}</label>
      <p v-if="hint" :id="hintId" class="text-sm text-fg-muted">{{ hint }}</p>
    </div>
  </div>
</template>
