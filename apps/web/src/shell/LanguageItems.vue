<script setup lang="ts">
import { Locale, LOCALES } from "@kitchen-ops/shared";
import { Check } from "lucide-vue-next";
import {
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "reka-ui";
import { useI18n } from "vue-i18n";
import { option as optionClass } from "../components/ui/styles";
import { showToast } from "../components/ui/toasts";
import { chooseLocale, useT } from "../i18n";
import { LANGUAGE_NAMES } from "../i18n/locale";

// The languages, as radio items inside a menu: the user menu's, or the sign-in page's.
const props = defineProps<{
  /** Signed in, a choice is saved as the user's at once; signed out, once they sign in. */
  signedIn: boolean;
}>();
const t = useT();
const { locale } = useI18n();

async function choose(value: unknown) {
  try {
    await chooseLocale(Locale.parse(value), props.signedIn);
  } catch {
    showToast({ tone: "error", title: t("language.saveFailed") });
  }
}
</script>

<template>
  <DropdownMenuLabel class="px-3 py-1.5 text-xs font-semibold text-fg-muted">
    {{ t("language.label") }}
  </DropdownMenuLabel>
  <DropdownMenuRadioGroup :model-value="locale" @update:model-value="choose">
    <DropdownMenuRadioItem
      v-for="language in LOCALES"
      :key="language"
      :value="language"
      :lang="language"
      :class="optionClass"
    >
      <DropdownMenuItemIndicator class="absolute start-2 flex items-center">
        <Check class="size-4" aria-hidden="true" />
      </DropdownMenuItemIndicator>
      {{ LANGUAGE_NAMES[language] }}
    </DropdownMenuRadioItem>
  </DropdownMenuRadioGroup>
</template>
