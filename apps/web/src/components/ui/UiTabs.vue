<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";

// Tabs (#85), on Reka UI: Tab reaches the active tab, arrow keys move between tabs, and each
// panel is named by its tab. A slot per tab, named by its value.
export interface Tab {
  value: string;
  label: string;
  disabled?: boolean;
}

defineProps<{
  tabs: readonly Tab[];
  /** What the tabs are about, for screen readers. */
  label: string;
}>();
const model = defineModel<string>();
</script>

<template>
  <TabsRoot
    v-model="model"
    :default-value="tabs[0]?.value"
    class="flex flex-col gap-4"
  >
    <TabsList
      :aria-label="label"
      class="flex gap-1 overflow-x-auto border-b border-line"
    >
      <TabsTrigger
        v-for="tab in tabs"
        :key="tab.value"
        :value="tab.value"
        :disabled="tab.disabled"
        class="-mb-px min-h-11 shrink-0 border-b-2 border-transparent px-4 font-medium text-fg-muted hover:text-fg data-[state=active]:border-primary data-[state=active]:text-primary data-disabled:cursor-not-allowed data-disabled:opacity-60"
      >
        {{ tab.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent v-for="tab in tabs" :key="tab.value" :value="tab.value">
      <slot :name="tab.value" />
    </TabsContent>
  </TabsRoot>
</template>
