<script setup lang="ts">
import { Locale, LOCALES } from "@kitchen-ops/shared";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { chooseLocale, useT } from "../i18n";
import { LANGUAGE_NAMES } from "../i18n/locale";

// The language menu (#86). Moves into the user menu with the app shell (#85).
const props = defineProps<{
  /** Signed in, a choice is saved as the user's at once; signed out, once they sign in. */
  signedIn: boolean;
}>();

const t = useT();
const { locale } = useI18n();
const saveFailed = ref(false);

async function change(event: Event) {
  const chosen = Locale.parse((event.target as HTMLSelectElement).value);
  saveFailed.value = false;
  try {
    await chooseLocale(chosen, props.signedIn);
  } catch {
    saveFailed.value = true;
  }
}
</script>

<template>
  <label class="language">
    {{ t("language.label") }}
    <select :value="locale" @change="change">
      <!-- Each name is in its own language, and marked as such (WCAG 3.1.2). -->
      <option
        v-for="option in LOCALES"
        :key="option"
        :value="option"
        :lang="option"
      >
        {{ LANGUAGE_NAMES[option] }}
      </option>
    </select>
  </label>
  <p v-if="saveFailed" class="error" role="alert">
    {{ t("language.saveFailed") }}
  </p>
</template>
