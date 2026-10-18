<script setup lang="ts">
import { watchEffect } from "vue";
import { RouterView, useRoute } from "vue-router";
import UiToaster from "./components/ui/UiToaster.vue";
import { useT } from "./i18n";

const t = useT();
const route = useRoute();

// The browser tab says which page this is, in the user's language: "Productos · kitchen-ops".
watchEffect(() => {
  const app = t("app.name");
  document.title = route.meta.title ? `${t(route.meta.title)} · ${app}` : app;
});
</script>

<template>
  <RouterView />
  <UiToaster />
</template>
