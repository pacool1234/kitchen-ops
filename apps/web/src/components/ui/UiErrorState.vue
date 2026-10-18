<script setup lang="ts">
import { RotateCw, TriangleAlert } from "lucide-vue-next";
import { useT } from "../../i18n";
import UiButton from "./UiButton.vue";

// What an area shows when loading it failed (#85): what happened, and a way to try again.
// Announced at once (role="alert").
defineProps<{
  message: string;
  title?: string;
  /** Shows "Reintentar", which emits `retry`. */
  retryable?: boolean;
}>();
defineEmits<{ retry: [] }>();
const t = useT();
</script>

<template>
  <div
    role="alert"
    class="flex flex-col items-center gap-3 px-6 py-10 text-center"
  >
    <TriangleAlert
      class="size-10 text-danger"
      :stroke-width="1.5"
      aria-hidden="true"
    />
    <p class="text-lg font-semibold text-fg">
      {{ title ?? t("ui.error.title") }}
    </p>
    <p class="max-w-sm text-fg-muted">{{ message }}</p>
    <UiButton
      v-if="retryable"
      variant="secondary"
      :icon="RotateCw"
      class="mt-2"
      @click="$emit('retry')"
    >
      {{ t("ui.error.retry") }}
    </UiButton>
  </div>
</template>
