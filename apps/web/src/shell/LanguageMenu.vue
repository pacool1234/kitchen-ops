<script setup lang="ts">
import { Locale } from "@kitchen-ops/shared";
import { ChevronDown, Languages } from "lucide-vue-next";
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "reka-ui";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { popover } from "../components/ui/styles";
import { useT } from "../i18n";
import { LANGUAGE_NAMES } from "../i18n/locale";
import LanguageItems from "./LanguageItems.vue";

// The language menu on the sign-in pages, before anyone is signed in (#86, #85). Signed in,
// the language is in the user menu.
const t = useT();
const { locale } = useI18n();
const current = computed(() => LANGUAGE_NAMES[Locale.parse(locale.value)]);
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <!-- Named "Idioma: Español": it starts with the menu's purpose and contains what's shown. -->
    <DropdownMenuTrigger
      :aria-label="t('language.current', { language: current })"
      class="inline-flex min-h-11 items-center gap-2 rounded-md px-3 font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
    >
      <Languages class="size-5" aria-hidden="true" />
      {{ current }}
      <ChevronDown class="size-4" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        align="end"
        :side-offset="4"
        :class="[popover, 'w-48']"
      >
        <LanguageItems :signed-in="false" />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
