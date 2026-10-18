<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import { useT } from "../i18n";
import LanguageMenu from "./LanguageMenu.vue";

// The frame of the pages before sign-in (#85): sign-in and the owner's 2FA setup. One card in
// the middle, the brand above it, and the language menu.
const t = useT();
const route = useRoute();
const title = computed(() => (route.meta.title ? t(route.meta.title) : ""));
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="flex items-center justify-between gap-4 px-4 py-3 sm:px-8">
      <div class="flex items-center gap-2">
        <img src="/icon.svg" alt="" class="size-8" />
        <span class="text-lg font-bold">{{ t("app.name") }}</span>
      </div>
      <LanguageMenu />
    </header>
    <main
      id="content"
      class="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:items-center"
    >
      <div
        class="flex w-full max-w-lg flex-col gap-6 rounded-xl border border-line bg-surface p-6 shadow-md sm:p-8"
      >
        <h1
          data-page-title
          tabindex="-1"
          class="text-2xl font-bold outline-none"
        >
          {{ title }}
        </h1>
        <RouterView />
      </div>
    </main>
  </div>
</template>
