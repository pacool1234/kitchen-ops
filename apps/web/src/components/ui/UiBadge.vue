<script setup lang="ts">
// A short status label (#85): "Activo", "Pendiente". Its text says the status; the colour
// only repeats it (WCAG 1.4.1).
withDefaults(
  defineProps<{
    tone?: "neutral" | "primary" | "success" | "warning" | "danger" | "info";
  }>(),
  { tone: "neutral" },
);

const tones = {
  neutral: "bg-surface-muted text-fg",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
      tones[tone],
    ]"
  >
    <slot />
  </span>
</template>
