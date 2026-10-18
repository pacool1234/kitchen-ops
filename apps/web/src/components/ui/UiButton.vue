<script setup lang="ts">
import { LoaderCircle } from "lucide-vue-next";
import type { Component } from "vue";

// A button (#85). `primary` for the one main action on a page, `secondary` beside it,
// `ghost` for quiet actions in toolbars and tables, `danger` for what deletes or reverses.
const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
    type?: "button" | "submit" | "reset";
    /** Working: shows a spinner and can't be pressed again meanwhile. */
    loading?: boolean;
    disabled?: boolean;
    /** An icon before the label. */
    icon?: Component;
  }>(),
  { variant: "primary", size: "md", type: "button" },
);

const variants = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary:
    "border border-primary bg-surface text-primary hover:bg-primary-soft",
  ghost: "text-primary hover:bg-primary-soft",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
};
// 44px and 36px tall: both well above WCAG 2.5.8's 24px target.
const sizes = { md: "min-h-11 px-4 text-base", sm: "min-h-9 px-3 text-sm" };
</script>

<template>
  <button
    :type="props.type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="[
      'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors',
      'disabled:cursor-not-allowed disabled:opacity-60',
      variants[variant],
      sizes[size],
    ]"
  >
    <LoaderCircle
      v-if="loading"
      class="size-4 animate-spin"
      aria-hidden="true"
    />
    <component :is="icon" v-else-if="icon" class="size-4" aria-hidden="true" />
    <slot />
  </button>
</template>
