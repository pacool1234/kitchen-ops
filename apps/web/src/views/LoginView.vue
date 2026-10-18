<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../auth";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import { type MessageKey, useT } from "../i18n";

const t = useT();
const router = useRouter();
const email = ref("");
const password = ref("");
const code = ref("");
// Owners with 2FA get a second step after the password.
const step = ref<"password" | "code">("password");
// A key, not the text, so it changes language with the page.
const error = ref<MessageKey>();
const busy = ref(false);

async function signIn() {
  error.value = undefined;
  busy.value = true;
  const result = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  });
  busy.value = false;
  if (result.error) {
    error.value =
      result.error.status === 429
        ? "signIn.tooManyAttempts"
        : "signIn.wrongPassword";
    return;
  }
  if (result.data && "twoFactorRedirect" in result.data) {
    step.value = "code";
    return;
  }
  await router.push("/products");
}

async function verifyCode() {
  error.value = undefined;
  busy.value = true;
  const result = await authClient.twoFactor.verifyTotp({ code: code.value });
  busy.value = false;
  if (result.error) {
    error.value = "signIn.invalidCode";
    return;
  }
  await router.push("/products");
}
</script>

<template>
  <div class="legacy">
    <LanguageSwitch :signed-in="false" />
    <h1>{{ t("signIn.title") }}</h1>

    <form v-if="step === 'password'" @submit.prevent="signIn">
      <label>
        {{ t("signIn.email") }}
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label>
        {{ t("signIn.password") }}
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <button type="submit" :disabled="busy">
        {{ t("signIn.submit") }}
      </button>
    </form>

    <form v-else @submit.prevent="verifyCode">
      <p>{{ t("signIn.codePrompt") }}</p>
      <label>
        {{ t("signIn.code") }}
        <input
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          maxlength="6"
          required
        />
      </label>
      <button type="submit" :disabled="busy">{{ t("signIn.verify") }}</button>
    </form>

    <p v-if="error" class="error" role="alert">{{ t(error) }}</p>
  </div>
</template>
