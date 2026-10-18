<script setup lang="ts">
import { RouterLink } from "vue-router";
import { useT, type MessageKey } from "../i18n";

// The catalogue's sections (#89, decision 0027): one item in the main navigation, and these
// links between its lists. Links, not tabs: each section is its own page, with its own URL.
const t = useT();
const sections: { name: string; label: MessageKey }[] = [
  { name: "products", label: "products.title" },
  { name: "suppliers", label: "suppliers.title" },
  { name: "storerooms", label: "storerooms.title" },
];
</script>

<template>
  <nav :aria-label="t('catalogue.sections')" class="border-b border-line">
    <ul class="-mb-px flex gap-1 overflow-x-auto">
      <li v-for="section in sections" :key="section.name">
        <RouterLink
          :to="{ name: section.name }"
          class="flex min-h-11 items-center border-b-2 border-transparent px-4 font-medium whitespace-nowrap text-fg-muted hover:text-fg aria-[current=page]:border-primary aria-[current=page]:text-primary"
        >
          {{ t(section.label) }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
