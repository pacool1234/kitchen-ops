<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, X } from "lucide-vue-next";
import {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from "reka-ui";
import { useT } from "../../i18n";
import { dismissToast, toasts } from "./toasts";

// Where toasts appear (#85), mounted once in App.vue, on Reka UI. Screen readers hear each
// one: an error at once, the others politely. An error stays until closed, because a notice
// that leaves on its own can be missed (WCAG 2.2.1); F8 moves focus to the notices.
const t = useT();

const icons = { success: CircleCheck, error: CircleAlert, info: Info };
const tones = {
  success: "text-success",
  error: "text-danger",
  info: "text-info",
};
</script>

<template>
  <ToastProvider :label="t('ui.toast.region')" swipe-direction="right">
    <ToastRoot
      v-for="toast in toasts"
      :key="toast.id"
      :type="toast.tone === 'error' ? 'foreground' : 'background'"
      :duration="toast.tone === 'error' ? Infinity : 6000"
      class="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-fg shadow-lg"
      @update:open="(open: boolean) => open || dismissToast(toast.id)"
    >
      <component
        :is="icons[toast.tone]"
        :class="['mt-0.5 size-5 shrink-0', tones[toast.tone]]"
        aria-hidden="true"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <ToastTitle class="font-semibold">{{ toast.title }}</ToastTitle>
        <ToastDescription
          v-if="toast.description"
          class="text-sm text-fg-muted"
        >
          {{ toast.description }}
        </ToastDescription>
      </div>
      <ToastClose
        :aria-label="t('ui.toast.close')"
        class="-me-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted"
      >
        <X class="size-4" aria-hidden="true" />
      </ToastClose>
    </ToastRoot>
    <!-- Named in the user's language; Reka fills in {hotkey}, the key that jumps here (F8). -->
    <ToastViewport
      :label="`${t('ui.toast.region')} ({hotkey})`"
      class="fixed end-0 bottom-(--bottom-nav-height) z-[100] flex w-full max-w-sm flex-col gap-2 p-4 outline-none"
    />
  </ToastProvider>
</template>
