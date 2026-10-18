<script setup lang="ts">
import { ChevronDown, LogOut } from "lucide-vue-next";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "reka-ui";
import { useRouter } from "vue-router";
import { authClient, type Me } from "../auth";
import UiBadge from "../components/ui/UiBadge.vue";
import { option, popover } from "../components/ui/styles";
import { useT } from "../i18n";
import { setCurrentUser } from "../session";
import LanguageItems from "./LanguageItems.vue";
import { initials } from "./layout";

// The user menu (#85), on Reka UI's DropdownMenu: who is signed in, their language, and
// sign-out. Enter or Space opens it, the arrow keys move, Escape closes.
defineProps<{ user: Me }>();
const t = useT();
const router = useRouter();

async function signOut() {
  await authClient.signOut();
  setCurrentUser(null);
  await router.push({ name: "login" });
}
</script>

<template>
  <!-- Not modal, like any menu (WAI-ARIA): a modal one hides the page from screen readers
       while it can still take focus. -->
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger
      class="flex min-h-11 items-center gap-2 rounded-full p-1 pe-2 hover:bg-surface-muted"
    >
      <span
        aria-hidden="true"
        class="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary"
      >
        {{ initials(user.name) }}
      </span>
      <!-- The name stays in the button's accessible name when it's hidden on phones. -->
      <span class="font-medium max-sm:sr-only">{{ user.name }}</span>
      <span class="sr-only">{{ t("shell.userMenu") }}</span>
      <ChevronDown class="size-4 text-fg-muted" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        :side-offset="6"
        :class="[popover, 'w-64']"
      >
        <div class="flex flex-col gap-1 px-3 py-2">
          <p class="font-semibold">{{ user.name }}</p>
          <p class="truncate text-sm text-fg-muted">{{ user.email }}</p>
          <UiBadge tone="primary" class="mt-1 self-start">
            {{ t(`roles.${user.role}`) }}
          </UiBadge>
        </div>
        <DropdownMenuSeparator class="my-1 h-px bg-line" />
        <LanguageItems :signed-in="true" />
        <DropdownMenuSeparator class="my-1 h-px bg-line" />
        <DropdownMenuItem :class="option" @select="signOut">
          <LogOut class="absolute start-2 size-4" aria-hidden="true" />
          {{ t("shell.signOut") }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
