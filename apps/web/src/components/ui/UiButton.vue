<script setup lang="ts">
import { LoaderCircle } from "lucide-vue-next";
import type { Component } from "vue";
import { buttonBase, buttonSizes, buttonVariants } from "./styles";

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

const variants = buttonVariants;
const sizes = buttonSizes;
</script>

<template>
  <button
    :type="props.type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="[
      buttonBase,
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
