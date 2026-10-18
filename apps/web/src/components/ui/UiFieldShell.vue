<script setup lang="ts">
import { CircleAlert } from "lucide-vue-next";
import { computed, useId } from "vue";
import { useT } from "../../i18n";

// A form field's frame (#85): its label, hint and error, tied to the control by id and
// aria-describedby, so a screen reader reads them with it. The control comes in the slot.
const props = defineProps<{
  label: string;
  hint?: string;
  error?: string;
  /** Marked "(optional)"; fields are required unless they say this. */
  optional?: boolean;
  /** More ids that describe the control, such as a number field's unit. */
  describedBy?: string;
}>();

const t = useT();
const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;
const describedBy = computed(
  () =>
    [props.hint && hintId, props.error && errorId, props.describedBy]
      .filter(Boolean)
      .join(" ") || undefined,
);
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="text-sm font-medium text-fg">
      {{ label }}
      <span v-if="optional" class="font-normal text-fg-muted">
        ({{ t("ui.optional") }})
      </span>
    </label>
    <p v-if="hint" :id="hintId" class="text-sm text-fg-muted">{{ hint }}</p>
    <p
      v-if="error"
      :id="errorId"
      class="flex items-center gap-1.5 text-sm font-medium text-danger"
    >
      <CircleAlert class="size-4 shrink-0" aria-hidden="true" />
      {{ error }}
    </p>
    <slot :id="id" :described-by="describedBy" :invalid="Boolean(error)" />
  </div>
</template>
