<script setup lang="ts">
import { watchEffect } from "vue";
import { RouterView, useRoute } from "vue-router";
import UiToaster from "./components/ui/UiToaster.vue";
import { useT } from "./i18n";
import { applyUpdate, noticeClosed, updateWaiting } from "./shell/app-update";
import AppUpdateNotice from "./shell/AppUpdateNotice.vue";
import { ownTitle } from "./shell/title";

const t = useT();
const route = useRoute();

// The browser tab says which page this is, in the user's language: "Productos · kitchen-ops".
watchEffect(() => {
  const app = t("app.name");
  const page =
    ownTitle.value?.text ?? (route.meta.title ? t(route.meta.title) : "");
  document.title = page ? `${page} · ${app}` : app;
});
</script>

<template>
  <AppUpdateNotice
    v-if="updateWaiting && !noticeClosed"
    @reload="applyUpdate()"
    @close="noticeClosed = true"
  />
  <RouterView />
  <UiToaster />
</template>
