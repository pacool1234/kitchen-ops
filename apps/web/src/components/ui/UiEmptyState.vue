<script setup lang="ts">
import { Inbox } from "lucide-vue-next";
import type { Component } from "vue";

// What a list or page shows when there's nothing in it yet (#85): what's missing, and the
// action that adds it, if there is one.
defineProps<{
  title: string;
  description?: string;
  icon?: Component;
}>();
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-10 text-center">
    <component
      :is="icon ?? Inbox"
      class="size-10 text-fg-muted"
      :stroke-width="1.5"
      aria-hidden="true"
    />
    <p class="text-lg font-semibold text-fg">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-fg-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-2">
      <slot />
    </div>
  </div>
</template>
