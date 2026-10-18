<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../auth";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { useT, type MessageKey } from "../i18n";

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
  await router.push({ name: "home" });
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
  await router.push({ name: "home" });
}
</script>

<template>
  <UiAlert v-if="error" tone="error">{{ t(error) }}</UiAlert>

  <form
    v-if="step === 'password'"
    class="flex flex-col gap-5"
    @submit.prevent="signIn"
  >
    <UiTextField
      v-model="email"
      :label="t('signIn.email')"
      type="email"
      autocomplete="username"
    />
    <UiTextField
      v-model="password"
      :label="t('signIn.password')"
      type="password"
      autocomplete="current-password"
    />
    <UiButton type="submit" :loading="busy" class="w-full">
      {{ t("signIn.submit") }}
    </UiButton>
  </form>

  <form v-else class="flex flex-col gap-5" @submit.prevent="verifyCode">
    <p class="text-fg-muted">{{ t("signIn.codePrompt") }}</p>
    <UiTextField
      v-model="code"
      :label="t('signIn.code')"
      inputmode="numeric"
      autocomplete="one-time-code"
      pattern="[0-9]{6}"
      maxlength="6"
    />
    <UiButton type="submit" :loading="busy" class="w-full">
      {{ t("signIn.verify") }}
    </UiButton>
  </form>
</template>
