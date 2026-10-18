<script setup lang="ts">
import { useT } from "../../i18n";
import UiSkeleton from "./UiSkeleton.vue";

// An area that's loading (#85): skeleton lines in the shape of what's coming, and one
// "Cargando…" for screen readers. A slot replaces the lines with a closer shape.
withDefaults(defineProps<{ lines?: number }>(), { lines: 3 });
const t = useT();
</script>

<template>
  <div role="status" class="flex flex-col gap-3">
    <span class="sr-only">{{ t("ui.loading") }}</span>
    <slot>
      <UiSkeleton
        v-for="line in lines"
        :key="line"
        :class="line === lines ? 'w-2/3' : 'w-full'"
      />
    </slot>
  </div>
</template>
