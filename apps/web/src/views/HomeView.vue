<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useT } from "../i18n";
import { currentUser } from "../session";
import { NAV, visibleNav } from "../shell/nav";

// Inicio (#85): a greeting, and a shortcut to each place the user's role can go. Later, the
// day's tasks.
const t = useT();
const shortcuts = computed(() =>
  currentUser.value
    ? visibleNav(NAV, currentUser.value.role).filter((i) => i.description)
    : [],
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <div>
      <p v-if="currentUser" class="text-lg font-medium">
        {{ t("home.greeting", { name: currentUser.name }) }}
      </p>
      <p class="text-fg-muted">{{ t("home.intro") }}</p>
    </div>
    <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="item in shortcuts" :key="item.name">
        <RouterLink
          :to="{ name: item.name }"
          class="group flex h-full gap-4 rounded-lg border border-line bg-surface p-5 shadow-sm transition-colors hover:border-primary"
        >
          <span
            class="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary"
          >
            <component :is="item.icon" class="size-6" aria-hidden="true" />
          </span>
          <span class="flex flex-col gap-1">
            <span class="font-semibold group-hover:text-primary">
              {{ t(item.label) }}
            </span>
            <span v-if="item.description" class="text-sm text-fg-muted">
              {{ t(item.description) }}
            </span>
          </span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
