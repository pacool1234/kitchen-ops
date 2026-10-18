<script setup lang="ts">
import { useId } from "vue";

// One component's part of the gallery: a region named by its heading.
defineProps<{ title: string; description?: string }>();
const id = useId();
</script>

<template>
  <section
    :aria-labelledby="id"
    class="flex flex-col gap-4 border-t border-line pt-8"
  >
    <div>
      <h2 :id="id" class="text-2xl font-semibold">{{ title }}</h2>
      <p v-if="description" class="mt-1 text-fg-muted">{{ description }}</p>
    </div>
    <slot />
  </section>
</template>
