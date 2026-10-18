<script setup lang="ts">
import { ChevronRight } from "lucide-vue-next";
import { computed } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { useT } from "../i18n";
import { currentUser } from "../session";
import { breadcrumbTrail } from "./layout";
import { NAV, visibleNav } from "./nav";
import UserMenu from "./UserMenu.vue";

// The frame of every signed-in page (#85). From 1024px: a sidebar with the navigation. Below:
// a top bar and a bottom navigation bar, phone-first for counter tasks (spec section 11.2).
// Every page gets its title as the h1, a breadcrumb, and a skip link to its content.
const t = useT();
const route = useRoute();
const router = useRouter();

const user = computed(() => currentUser.value);
const items = computed(() =>
  user.value ? visibleNav(NAV, user.value.role) : [],
);
const title = computed(() => (route.meta.title ? t(route.meta.title) : ""));
const trail = computed(() =>
  breadcrumbTrail(String(route.name), (name) => {
    const meta = router.getRoutes().find((r) => r.name === name)?.meta;
    return meta && { title: meta.title && t(meta.title), parent: meta.parent };
  }),
);
</script>

<template>
  <div class="min-h-dvh lg:flex">
    <a
      href="#content"
      class="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold focus:text-primary focus:shadow-lg"
    >
      {{ t("shell.skipToContent") }}
    </a>

    <aside
      class="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-line bg-surface lg:flex"
    >
      <div class="flex h-16 items-center gap-3 border-b border-line px-5">
        <img src="/icon.svg" alt="" class="size-8" />
        <span class="text-lg font-bold">{{ t("app.name") }}</span>
      </div>
      <nav :aria-label="t('shell.mainNav')" class="flex-1 overflow-y-auto p-3">
        <ul class="flex flex-col gap-1">
          <li v-for="item in items" :key="item.name">
            <RouterLink
              :to="{ name: item.name }"
              class="flex min-h-11 items-center gap-3 rounded-md px-3 font-medium text-fg-muted hover:bg-surface-muted hover:text-fg aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
            >
              <component :is="item.icon" class="size-5" aria-hidden="true" />
              {{ t(item.label) }}
            </RouterLink>
          </li>
        </ul>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-line bg-surface px-4 lg:justify-end lg:px-8"
      >
        <div class="flex items-center gap-2 lg:hidden">
          <img src="/icon.svg" alt="" class="size-7" />
          <span class="font-bold">{{ t("app.name") }}</span>
        </div>
        <UserMenu v-if="user" :user="user" />
      </header>

      <main
        id="content"
        tabindex="-1"
        class="flex-1 px-4 pt-6 pb-[calc(var(--bottom-nav-height)+2rem)] outline-none lg:px-8 lg:pt-8"
      >
        <div class="mx-auto flex max-w-6xl flex-col gap-6">
          <div class="flex flex-col gap-1">
            <nav v-if="trail.length > 1" :aria-label="t('shell.breadcrumb')">
              <ol
                class="flex flex-wrap items-center gap-1 text-sm text-fg-muted"
              >
                <li
                  v-for="(crumb, i) in trail"
                  :key="crumb.name"
                  class="flex items-center gap-1"
                >
                  <ChevronRight
                    v-if="i > 0"
                    class="size-4"
                    aria-hidden="true"
                  />
                  <RouterLink
                    v-if="i < trail.length - 1"
                    :to="{ name: crumb.name }"
                    class="underline-offset-4 hover:text-primary hover:underline"
                  >
                    {{ crumb.title }}
                  </RouterLink>
                  <span v-else aria-current="page" class="text-fg">
                    {{ crumb.title }}
                  </span>
                </li>
              </ol>
            </nav>
            <h1
              data-page-title
              tabindex="-1"
              class="text-2xl font-bold outline-none lg:text-3xl"
            >
              {{ title }}
            </h1>
          </div>
          <RouterView />
        </div>
      </main>

      <nav
        data-bottom-nav
        :aria-label="t('shell.mainNav')"
        class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul class="flex">
          <li v-for="item in items" :key="item.name" class="flex-1">
            <RouterLink
              :to="{ name: item.name }"
              class="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-fg-muted aria-[current=page]:text-primary"
            >
              <component :is="item.icon" class="size-6" aria-hidden="true" />
              {{ t(item.label) }}
            </RouterLink>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>
