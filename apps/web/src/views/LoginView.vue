<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../auth";

const router = useRouter();
const email = ref("");
const password = ref("");
const code = ref("");
// Owners with 2FA get a second step after the password.
const step = ref<"password" | "code">("password");
const error = ref("");
const busy = ref(false);

async function signIn() {
  error.value = "";
  busy.value = true;
  const result = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  });
  busy.value = false;
  if (result.error) {
    error.value =
      result.error.status === 429
        ? "Too many attempts. Wait a few minutes and try again."
        : "Wrong email or password.";
    return;
  }
  if (result.data && "twoFactorRedirect" in result.data) {
    step.value = "code";
    return;
  }
  await router.push("/products");
}

async function verifyCode() {
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
  <h1>Sign in</h1>

  <form v-if="step === 'password'" @submit.prevent="signIn">
    <label>
      Email
      <input v-model="email" type="email" autocomplete="username" required />
    </label>
    <label>
      Password
      <input
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
      />
    </label>
    <button type="submit" :disabled="busy">Sign in</button>
  </form>

  <form v-else @submit.prevent="verifyCode">
    <p>Enter the 6-digit code from your authenticator app.</p>
    <label>
      Code
      <input
        v-model="code"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]{6}"
        maxlength="6"
        required
      />
    </label>
    <button type="submit" :disabled="busy">Verify</button>
  </form>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
</template>
