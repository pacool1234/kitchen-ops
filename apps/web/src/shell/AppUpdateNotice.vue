<script setup lang="ts">
import { RotateCw, X } from "lucide-vue-next";
import UiButton from "../components/ui/UiButton.vue";
import { useT } from "../i18n";

// A new version of the app is waiting (#139, decision 0042): a bar above every page, announced
// politely. Reloading takes it now; otherwise moving to another page does.
defineEmits<{ reload: []; close: [] }>();
const t = useT();
</script>

<template>
  <div
    role="status"
    class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-info bg-info-soft px-4 py-2 text-fg"
  >
    <p class="flex-1">{{ t("shell.update.available") }}</p>
    <div class="flex items-center gap-2">
      <UiButton size="sm" :icon="RotateCw" @click="$emit('reload')">
        {{ t("shell.update.reload") }}
      </UiButton>
      <button
        type="button"
        :aria-label="t('shell.update.close')"
        class="flex size-10 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted"
        @click="$emit('close')"
      >
        <X class="size-5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
