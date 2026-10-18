<script setup lang="ts">
import { RouterView, useRoute } from "vue-router";
import UiToaster from "./components/ui/UiToaster.vue";
import { useT } from "./i18n";

const t = useT();
const route = useRoute();
</script>

<template>
  <header class="app-header">{{ t("app.name") }}</header>
  <main :class="route.meta.wide ? 'app-main-wide' : 'app-main'">
    <RouterView />
  </main>
  <UiToaster />
</template>
