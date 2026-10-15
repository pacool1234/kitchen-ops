<script setup lang="ts">
import QRCode from "qrcode";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../auth";

// Owners must use 2FA (spec section 6). Until it is set up, the API answers every request with
// two_factor_required and the router sends the owner here.
const router = useRouter();
const password = ref("");
const code = ref("");
const step = ref<"password" | "scan">("password");
const qrDataUrl = ref("");
const manualKey = ref("");
const backupCodes = ref<string[]>([]);
const error = ref("");
const busy = ref(false);

async function start() {
  error.value = "";
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
    error.value = "Wrong password.";
    return;
  }
  if (result.data.method !== "totp") {
    error.value = "Unexpected answer from the server. Try again.";
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
  error.value = "";
  busy.value = true;
  const result = await authClient.twoFactor.verifyTotp({ code: code.value });
  busy.value = false;
  if (result.error) {
    error.value =
      "That code is not valid. Enter the current one from your app.";
    return;
  }
  await router.push("/products");
}
</script>

<template>
  <h1>Set up two-factor authentication</h1>

  <form v-if="step === 'password'" @submit.prevent="start">
    <p>
      Owner accounts need an authenticator app (for example Google
      Authenticator, Microsoft Authenticator or 1Password). Confirm your
      password to start.
    </p>
    <label>
      Password
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
      />
    </label>
    <button type="submit" :disabled="busy">Continue</button>
  </form>

  <form v-else @submit.prevent="confirm">
    <p>Scan this code with your authenticator app:</p>
    <img :src="qrDataUrl" alt="QR code for your authenticator app" class="qr" />
    <p>
      Or type this key into the app:
      <code class="key">{{ manualKey }}</code>
    </p>
    <p>
      <strong>Backup codes.</strong> Each works once if you lose your phone.
      Store them somewhere safe now; they are not shown again.
    </p>
    <ul class="codes">
      <li v-for="backup in backupCodes" :key="backup">
        <code>{{ backup }}</code>
      </li>
    </ul>
    <label>
      Code from the app
      <input
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]{6}"
        maxlength="6"
        required
      />
    </label>
    <button type="submit" :disabled="busy">Turn on 2FA</button>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
</template>
