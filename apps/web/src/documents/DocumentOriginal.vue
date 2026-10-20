<script setup lang="ts">
import type { Document, DocumentFile } from "@kitchen-ops/shared";
import { computed, ref } from "vue";
import { useT } from "../i18n";
import PhotoViewer from "./PhotoViewer.vue";

// A document's original (#106, #118): its photos, each opening large to zoom in; or its PDF,
// shown in the page where the browser can (a desktop's does, a phone's doesn't), with a link to
// it either way; or a link to its Facturae XML.
const props = defineProps<{ document: Document }>();
const emit = defineEmits<{ expired: [] }>();
const t = useT();

const photos = computed(() =>
  props.document.files.filter((f) => f.kind === "image"),
);
const pdf = computed(() => props.document.files.find((f) => f.kind === "pdf"));
const shown = ref<number | null>(null);

/**
 * A photo that won't load, most likely because its link has expired (they last 5 minutes):
 * the document again, with fresh links. Only for an expired link, so a broken file can't loop.
 */
function photoFailed(file: DocumentFile) {
  if (Date.parse(file.urlExpiresAt) - Date.now() < 30_000) emit("expired");
}
</script>

<template>
  <section class="flex flex-col gap-3" aria-labelledby="original-heading">
    <h2 id="original-heading" class="text-lg font-semibold">
      {{ t("documents.original") }}
    </h2>
    <template v-if="photos.length > 0">
      <ol class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
        <li v-for="(file, index) in photos" :key="file.id">
          <button
            type="button"
            class="block w-full rounded-md"
            :aria-label="
              t('documents.viewer.enlarge', {
                n: index + 1,
                count: photos.length,
              })
            "
            @click="shown = index"
          >
            <img
              :src="file.url"
              alt=""
              class="w-full rounded-md border border-line bg-surface-muted"
              @error="photoFailed(file)"
            />
          </button>
        </li>
      </ol>
      <PhotoViewer v-model="shown" :photos="photos" @failed="photoFailed" />
    </template>
    <template v-else>
      <object
        v-if="pdf"
        :data="pdf.url"
        type="application/pdf"
        :aria-label="t('documents.original')"
        class="hidden h-[70dvh] w-full rounded-md border border-line lg:block"
      ></object>
      <ul class="flex flex-col gap-2">
        <li v-for="file in document.files" :key="file.id">
          <a
            :href="file.url"
            target="_blank"
            rel="noopener"
            class="font-medium text-primary underline underline-offset-4"
          >
            {{
              t(file.kind === "xml" ? "documents.openXml" : "documents.openPdf")
            }}
          </a>
        </li>
      </ul>
    </template>
  </section>
</template>
