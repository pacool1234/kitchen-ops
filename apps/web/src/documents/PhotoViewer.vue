<script setup lang="ts">
import type { DocumentFile } from "@kitchen-ops/shared";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-vue-next";
import { computed, onUnmounted, ref, watch } from "vue";
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import { useT } from "../i18n";

// A document's photos, large (#118): to read a line next to its draft. Zoomed with the buttons
// or the + and - keys, and moved around by scrolling; on a phone, pinching works too. Escape
// closes it, and focus goes back to the photo that opened it.
const props = defineProps<{ photos: readonly DocumentFile[] }>();
/** The photo shown, by its index; null when closed. */
const shown = defineModel<number | null>({ required: true });
const emit = defineEmits<{ failed: [file: DocumentFile] }>();
const t = useT();

/** How wide the photo is, as a share of the viewer's width. */
const ZOOMS = [100, 150, 200, 300, 400] as const;
const step = ref(0);
const zoom = computed(() => ZOOMS[step.value]!);

const open = computed({
  get: () => shown.value !== null,
  set: (value) => {
    if (!value) shown.value = null;
  },
});
const photo = computed(() =>
  shown.value === null ? undefined : props.photos[shown.value],
);
// Each photo opens fitted to the viewer.
watch(shown, () => {
  step.value = 0;
});

const zoomIn = () => {
  step.value = Math.min(step.value + 1, ZOOMS.length - 1);
};
const zoomOut = () => {
  step.value = Math.max(step.value - 1, 0);
};

function onKey(event: KeyboardEvent) {
  if (event.key === "+" || event.key === "=") zoomIn();
  else if (event.key === "-") zoomOut();
  else return;
  event.preventDefault();
}
// The keys work wherever focus is in the viewer: it starts on the close button.
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("keydown", onKey);
  else document.removeEventListener("keydown", onKey);
});
onUnmounted(() => document.removeEventListener("keydown", onKey));

const move = (by: number) => {
  if (shown.value !== null) shown.value += by;
};
</script>

<template>
  <UiDialog
    v-model:open="open"
    wide
    :title="
      t('documents.photoOf', {
        n: (shown ?? 0) + 1,
        count: photos.length,
      })
    "
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <UiButton
          variant="secondary"
          size="sm"
          :icon="ZoomOut"
          :disabled="step === 0"
          @click="zoomOut"
        >
          {{ t("documents.viewer.zoomOut") }}
        </UiButton>
        <p role="status" class="w-16 text-center tabular">
          {{ t("documents.viewer.zoom", { n: zoom }) }}
        </p>
        <UiButton
          variant="secondary"
          size="sm"
          :icon="ZoomIn"
          :disabled="step === ZOOMS.length - 1"
          @click="zoomIn"
        >
          {{ t("documents.viewer.zoomIn") }}
        </UiButton>
        <UiButton
          variant="ghost"
          size="sm"
          :disabled="step === 0"
          @click="step = 0"
        >
          {{ t("documents.viewer.fit") }}
        </UiButton>
        <div v-if="photos.length > 1" class="ms-auto flex gap-2">
          <UiButton
            variant="secondary"
            size="sm"
            :icon="ChevronLeft"
            :disabled="shown === 0"
            @click="move(-1)"
          >
            {{ t("documents.viewer.previous") }}
          </UiButton>
          <UiButton
            variant="secondary"
            size="sm"
            :icon="ChevronRight"
            :disabled="shown === photos.length - 1"
            @click="move(1)"
          >
            {{ t("documents.viewer.next") }}
          </UiButton>
        </div>
      </div>
      <!-- Scrolls both ways once zoomed; a keyboard can scroll it too. -->
      <div
        v-if="photo"
        class="max-h-[70dvh] overflow-auto rounded-md border border-line bg-surface-muted"
        tabindex="0"
        role="region"
        :aria-label="
          t('documents.photoOf', { n: (shown ?? 0) + 1, count: photos.length })
        "
      >
        <img
          :src="photo.url"
          alt=""
          class="max-w-none"
          :style="{ width: `${zoom}%` }"
          @error="emit('failed', photo)"
        />
      </div>
    </div>
  </UiDialog>
</template>
