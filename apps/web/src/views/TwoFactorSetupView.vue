<script setup lang="ts">
import QRCode from "qrcode";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../auth";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import { type MessageKey, useT } from "../i18n";

// Owners must use 2FA (spec section 6). Until it is set up, the API answers every request with
// two_factor_required and the router sends the owner here.
const t = useT();
const router = useRouter();
const password = ref("");
const code = ref("");
const step = ref<"password" | "scan">("password");
const qrDataUrl = ref("");
const manualKey = ref("");
const backupCodes = ref<string[]>([]);
const error = ref<MessageKey>();
const busy = ref(false);

async function start() {
  error.value = undefined;
  busy.value = true;
  const result = await authClient.twoFactor.enable({
    password: password.value,
    method: "totp",
  });
  busy.value = false;
  if (result.error) {
    if (result.error.status === 401) {
      await router.push("/login");
      return;
    }
    error.value = "twoFactor.wrongPassword";
    return;
  }
  if (result.data.method !== "totp") {
    error.value = "twoFactor.unexpectedAnswer";
    return;
  }
  const { totpURI, backupCodes: codes } = result.data;
  qrDataUrl.value = await QRCode.toDataURL(totpURI, { margin: 1, width: 240 });
  // For typing into an authenticator app on the same phone, where scanning is impossible.
  manualKey.value = new URL(totpURI).searchParams.get("secret") ?? "";
  backupCodes.value = codes;
  step.value = "scan";
}

async function confirm() {
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
  <LanguageSwitch :signed-in="false" />
  <h1>{{ t("twoFactor.title") }}</h1>

  <form v-if="step === 'password'" @submit.prevent="start">
    <p>{{ t("twoFactor.intro") }}</p>
    <label>
      {{ t("twoFactor.password") }}
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
      />
    </label>
    <button type="submit" :disabled="busy">
      {{ t("twoFactor.continue") }}
    </button>
  </form>

  <form v-else @submit.prevent="confirm">
    <p>{{ t("twoFactor.scan") }}</p>
    <img :src="qrDataUrl" :alt="t('twoFactor.qrAlt')" class="qr" />
    <p>
      {{ t("twoFactor.manualKey") }}
      <code class="key">{{ manualKey }}</code>
    </p>
    <p>
      <strong>{{ t("twoFactor.backupTitle") }}</strong>
      {{ t("twoFactor.backupText") }}
    </p>
    <ul class="codes">
      <li v-for="backup in backupCodes" :key="backup">
        <code>{{ backup }}</code>
      </li>
    </ul>
    <label>
      {{ t("twoFactor.code") }}
      <input
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]{6}"
        maxlength="6"
        required
      />
    </label>
    <button type="submit" :disabled="busy">
      {{ t("twoFactor.submit") }}
    </button>
  </form>

  <p v-if="error" class="error" role="alert">{{ t(error) }}</p>
</template>
