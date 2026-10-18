<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { useId } from "vue";

// An on/off setting that applies at once (#85), on Reka UI. For a choice that's submitted
// with a form, use Checkbox.
const props = defineProps<{
  label: string;
  hint?: string;
  disabled?: boolean;
}>();
const model = defineModel<boolean>({ default: false });
const id = useId();
const hintId = `${id}-hint`;
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="flex flex-col gap-0.5">
      <label :for="id" class="font-medium text-fg">{{ label }}</label>
      <p v-if="hint" :id="hintId" class="text-sm text-fg-muted">{{ hint }}</p>
    </div>
    <SwitchRoot
      :id="id"
      v-model="model"
      :disabled="disabled"
      :aria-describedby="props.hint ? hintId : undefined"
      class="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-60"
    >
      <SwitchThumb
        class="block size-5 translate-x-1 rounded-full bg-surface shadow-sm transition-transform data-[state=checked]:translate-x-6"
      />
    </SwitchRoot>
  </div>
</template>
