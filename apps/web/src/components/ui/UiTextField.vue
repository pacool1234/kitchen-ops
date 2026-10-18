<script setup lang="ts">
import UiFieldShell from "./UiFieldShell.vue";
import { control } from "./styles";

// A text input with its label, hint and error (#85). Other attributes, such as autocomplete,
// go to the input.
defineOptions({ inheritAttrs: false });
defineProps<{
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  type?: "text" | "email" | "password" | "search" | "tel" | "url";
  disabled?: boolean;
}>();
const model = defineModel<string>({ default: "" });
</script>

<template>
  <UiFieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="label"
    :hint="hint"
    :error="error"
    :optional="optional"
  >
    <input
      :id="id"
      v-model="model"
      :type="type ?? 'text'"
      :class="control"
      :required="!optional"
      :disabled="disabled"
      :aria-describedby="describedBy"
      :aria-invalid="invalid || undefined"
      v-bind="$attrs"
    />
  </UiFieldShell>
</template>
