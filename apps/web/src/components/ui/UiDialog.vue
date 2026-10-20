<script setup lang="ts">
import { X } from "lucide-vue-next";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "reka-ui";
import { useT } from "../../i18n";

// A modal dialog (#85), on Reka UI: focus moves into it and stays there, Escape or the close
// button closes it, and focus goes back to what opened it. Its title names it for screen readers.
defineProps<{
  title: string;
  description?: string;
  /** For what needs room, such as a photo to read: nearly the whole screen. */
  wide?: boolean;
}>();
const open = defineModel<boolean>("open", { default: false });
const t = useT();
// Without a description, Reka wants aria-describedby passed as undefined, or it warns.
const noDescription = { "aria-describedby": undefined };
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        v-bind="description ? {} : noDescription"
        :class="[
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-6 text-fg shadow-lg',
          wide ? 'max-w-6xl' : 'max-w-lg',
        ]"
      >
        <div class="flex items-start justify-between gap-4">
          <DialogTitle class="text-xl font-semibold">{{ title }}</DialogTitle>
          <DialogClose
            :aria-label="t('ui.close')"
            class="-me-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted"
          >
            <X class="size-5" aria-hidden="true" />
          </DialogClose>
        </div>
        <DialogDescription v-if="description" class="text-fg-muted">
          {{ description }}
        </DialogDescription>
        <slot />
        <div
          v-if="$slots.footer"
          class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
        >
          <slot name="footer" :close="() => (open = false)" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
