<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-vue-next";

// A message inside a page or form (#85), such as a wrong password. An error is announced at
// once (role="alert"); the others politely (role="status").
const props = withDefaults(
  defineProps<{
    tone?: "error" | "warning" | "success" | "info";
    title?: string;
  }>(),
  { tone: "info" },
);

const styles = {
  error: {
    box: "border-danger bg-danger-soft",
    icon: "text-danger",
    is: CircleAlert,
  },
  warning: {
    box: "border-warning bg-warning-soft",
    icon: "text-warning",
    is: TriangleAlert,
  },
  success: {
    box: "border-success bg-success-soft",
    icon: "text-success",
    is: CircleCheck,
  },
  info: { box: "border-info bg-info-soft", icon: "text-info", is: Info },
};
</script>

<template>
  <div
    :role="props.tone === 'error' ? 'alert' : 'status'"
    :class="['flex gap-3 rounded-md border-s-4 p-4 text-fg', styles[tone].box]"
  >
    <component
      :is="styles[tone].is"
      :class="['mt-0.5 size-5 shrink-0', styles[tone].icon]"
      aria-hidden="true"
    />
    <div class="flex flex-col gap-1">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div><slot /></div>
    </div>
  </div>
</template>
