<script setup lang="ts">
import { Locale } from "@kitchen-ops/shared";
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useT, type MessageKey } from "../../i18n";
import UiFieldShell from "./UiFieldShell.vue";
import { formatDecimalInput, parseDecimalInput } from "./number";
import { control } from "./styles";

// A number field (#85, decision 0024). Its value is a decimal string ("2.5"), never a
// JavaScript number: what's typed is read exactly, with a comma or a point, and never rounded.
defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    label: string;
    hint?: string;
    error?: string;
    optional?: boolean;
    /** Shown after the value, such as "kg". */
    unit?: string;
    maxDecimals?: number;
    allowNegative?: boolean;
    disabled?: boolean;
  }>(),
  { maxDecimals: 3 },
);
const model = defineModel<string>({ default: "" });

const t = useT();
const { locale } = useI18n();
const unitId = useId();
const show = (value: string) =>
  formatDecimalInput(value, Locale.parse(locale.value));
const text = ref(show(model.value));
const typingError = ref<{ key: MessageKey; max?: number }>();

const parse = (value: string) =>
  parseDecimalInput(value, {
    maxDecimals: props.maxDecimals,
    allowNegative: props.allowNegative,
  });

function onInput() {
  const result = parse(text.value);
  if (result.ok) {
    typingError.value = undefined;
    if (result.value !== model.value) model.value = result.value;
  }
}

// The error shows once they leave the field, not while they're still typing "2,".
function onChange() {
  const result = parse(text.value);
  typingError.value = result.ok
    ? undefined
    : { key: `ui.number.${result.error}`, max: props.maxDecimals };
}

// A value set from outside replaces what's typed; what's typed stays as typed ("2,50").
watch(model, (value) => {
  const typed = parse(text.value);
  if (!typed.ok || typed.value !== value) {
    text.value = show(value);
    typingError.value = undefined;
  }
});

// In another language, the value is written that language's way.
watch(locale, () => {
  if (parse(text.value).ok) text.value = show(model.value);
});

const shownError = computed(
  () =>
    props.error ??
    (typingError.value &&
      t(typingError.value.key, { max: typingError.value.max })),
);
</script>

<template>
  <UiFieldShell
    v-slot="{ id, describedBy, invalid }"
    :label="label"
    :hint="hint"
    :error="shownError"
    :optional="optional"
    :described-by="unit ? unitId : undefined"
  >
    <div class="relative">
      <input
        :id="id"
        v-model="text"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :class="[control, 'tabular text-end', unit ? 'pe-12' : '']"
        :required="!optional"
        :disabled="disabled"
        :aria-describedby="describedBy"
        :aria-invalid="invalid || undefined"
        v-bind="$attrs"
        @input="onInput"
        @change="onChange"
      />
      <span
        v-if="unit"
        :id="unitId"
        class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-fg-muted"
      >
        {{ unit }}
      </span>
    </div>
  </UiFieldShell>
</template>
