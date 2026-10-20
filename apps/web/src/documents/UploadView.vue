<script setup lang="ts">
import { endpoints, type FieldErrorCode } from "@kitchen-ops/shared";
import { Camera, FileText, FolderOpen, X } from "lucide-vue-next";
import { computed, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { ApiError, call } from "../api";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import { buttonClasses } from "../components/ui/styles";
import { showToast } from "../components/ui/toasts";
import { useT } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";
import { checkChosen, kindOf } from "./upload";

// Uploading a document (#106): one or several photos of it, in order, taken with the phone's
// camera or chosen; or its PDF or Facturae XML, chosen or dropped on a desktop. What's chosen
// shows before sending, and any of it can be removed. The browser checks what it can first;
// the API checks each file's bytes.
const t = useT();
const router = useRouter();

interface Chosen {
  readonly id: number;
  readonly file: File;
  /** A photo's preview, until it's removed or the page closes. */
  readonly preview: string | null;
}

const chosen = ref<Chosen[]>([]);
let nextId = 1;
const problems = ref<Record<string, FieldErrorCode>>({});
const duplicateOf = ref<string>();
const sending = ref(false);

function add(files: FileList | null | undefined) {
  for (const file of files ?? []) {
    chosen.value.push({
      id: nextId++,
      file,
      preview: kindOf(file) === "image" ? URL.createObjectURL(file) : null,
    });
  }
  problems.value = {};
  duplicateOf.value = undefined;
}

function picked(event: Event) {
  const input = event.target as HTMLInputElement;
  add(input.files);
  // So the same file can be chosen again after removing it.
  input.value = "";
}

function remove(index: number) {
  const [gone] = chosen.value.splice(index, 1);
  if (gone?.preview) URL.revokeObjectURL(gone.preview);
  problems.value = {};
  duplicateOf.value = undefined;
}
onUnmounted(() => {
  for (const c of chosen.value) if (c.preview) URL.revokeObjectURL(c.preview);
});

/** What a chosen file is called: a photo by its place, anything else by its name. */
const nameOf = (c: Chosen, index: number) =>
  c.preview ? t("documents.photo", { n: index + 1 }) : c.file.name;

/** Each problem in words: the whole upload's, then each file's by its place. */
const messages = computed(() =>
  Object.entries(problems.value).map(([field, code]) => {
    const problem = t(
      fieldMessageKey(code, { required: "documents.chooseSomething" }),
    );
    const n = /^files\.(\d+)$/.exec(field)?.[1];
    return n ? t("documents.fileProblem", { n, problem }) : problem;
  }),
);

async function send() {
  const files = chosen.value.map((c) => c.file);
  problems.value = checkChosen(files);
  duplicateOf.value = undefined;
  if (Object.keys(problems.value).length > 0) return;

  sending.value = true;
  try {
    const document = await call(endpoints.uploadDocument, { files });
    showToast({ tone: "success", title: t("documents.sent") });
    await router.push({ name: "document", params: { id: document.id } });
  } catch (caught) {
    if (caught instanceof ApiError && caught.duplicateOf) {
      duplicateOf.value = caught.duplicateOf;
    } else if (caught instanceof ApiError && caught.fields) {
      problems.value = { ...caught.fields };
    } else {
      showToast({ tone: "error", title: t(errorMessageKey(caught)) });
    }
  } finally {
    sending.value = false;
  }
}

// The file inputs are hidden inside their labels, which look like buttons: the label shows the
// focus ring its input would (WCAG 2.4.7).
const FOCUS_WITHIN =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus";

const dragging = ref(false);
function dropped(event: DragEvent) {
  dragging.value = false;
  add(event.dataTransfer?.files);
}
</script>

<template>
  <form novalidate class="flex max-w-2xl flex-col gap-6" @submit.prevent="send">
    <p class="text-fg-muted">{{ t("documents.uploadIntro") }}</p>

    <div class="flex flex-col gap-3">
      <!-- On a phone: the camera, one photo at a time, then the files. -->
      <label
        :class="[buttonClasses(), FOCUS_WITHIN, 'cursor-pointer md:hidden']"
      >
        <Camera class="size-4" aria-hidden="true" />
        {{ t("documents.takePhoto") }}
        <input
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          class="sr-only"
          @change="picked"
        />
      </label>
      <!-- On a desktop: a place to drop files, with the same choice inside it. -->
      <div
        data-testid="drop-zone"
        :class="[
          'flex flex-col items-stretch gap-3 rounded-lg md:items-center md:border-2 md:border-dashed md:p-8',
          dragging ? 'md:border-primary md:bg-primary-soft' : 'md:border-line',
        ]"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="dropped"
      >
        <p class="hidden text-fg-muted md:block">
          {{ t("documents.dropHere") }}
        </p>
        <p class="hidden text-sm text-fg-muted md:block">
          {{ t("documents.or") }}
        </p>
        <label
          :class="[buttonClasses('secondary'), FOCUS_WITHIN, 'cursor-pointer']"
        >
          <FolderOpen class="size-4" aria-hidden="true" />
          {{ t("documents.chooseFiles") }}
          <input
            type="file"
            multiple
            accept=".pdf,.xml,.xsig,application/pdf,application/xml,text/xml,image/jpeg,image/png"
            class="sr-only"
            @change="picked"
          />
        </label>
      </div>
    </div>

    <ol
      v-if="chosen.length > 0"
      :aria-label="t('documents.chosen')"
      class="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      <li
        v-for="(c, index) in chosen"
        :key="c.id"
        class="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2"
      >
        <img
          v-if="c.preview"
          :src="c.preview"
          :alt="nameOf(c, index)"
          class="aspect-[3/4] w-full rounded-md bg-surface-muted object-cover"
        />
        <div
          v-else
          class="flex aspect-[3/4] items-center justify-center rounded-md bg-surface-muted"
        >
          <FileText class="size-10 text-fg-muted" aria-hidden="true" />
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 text-sm break-words">{{
            nameOf(c, index)
          }}</span>
          <UiButton
            variant="ghost"
            size="sm"
            :aria-label="t('documents.remove', { name: nameOf(c, index) })"
            @click="remove(index)"
          >
            <X class="size-4" aria-hidden="true" />
          </UiButton>
        </div>
      </li>
    </ol>

    <UiAlert v-if="messages.length > 0" tone="error">
      <ul class="flex flex-col gap-1">
        <li v-for="message in messages" :key="message">{{ message }}</li>
      </ul>
    </UiAlert>
    <UiAlert v-if="duplicateOf" tone="error">
      {{ t("documents.duplicate") }}
      <RouterLink
        :to="{ name: 'document', params: { id: duplicateOf } }"
        class="font-medium text-primary underline underline-offset-4"
      >
        {{ t("documents.seeDuplicate") }}
      </RouterLink>
    </UiAlert>

    <div class="flex justify-end">
      <UiButton type="submit" :loading="sending">
        {{ t("documents.send") }}
      </UiButton>
    </div>
  </form>
</template>
