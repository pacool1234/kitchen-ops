<script setup lang="ts">
import { RouterView } from "vue-router";
import { useT } from "./i18n";

const t = useT();
</script>

<template>
  <header class="app-header">{{ t("app.name") }}</header>
  <main class="app-main">
    <RouterView />
  </main>
</template>
