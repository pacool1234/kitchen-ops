<script setup lang="ts">
// A panel that groups related content (#85), with an optional heading and footer actions.
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    /** The heading's level in the page's outline: h2 by default. */
    headingLevel?: 2 | 3 | 4;
  }>(),
  { headingLevel: 2 },
);
</script>

<template>
  <section class="rounded-lg border border-line bg-surface text-fg shadow-sm">
    <header v-if="title" class="border-b border-line px-5 py-4">
      <component :is="`h${headingLevel}`" class="text-lg font-semibold">
        {{ title }}
      </component>
      <p v-if="description" class="mt-1 text-sm text-fg-muted">
        {{ description }}
      </p>
    </header>
    <div class="p-5">
      <slot />
    </div>
    <footer
      v-if="$slots.footer"
      class="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3"
    >
      <slot name="footer" />
    </footer>
  </section>
</template>
