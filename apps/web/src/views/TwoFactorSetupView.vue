<script setup lang="ts">
import { Copy } from "lucide-vue-next";
import QRCode from "qrcode";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { authClient } from "../auth";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { showToast } from "../components/ui/toasts";
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
      await router.push({ name: "login" });
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

async function copy(text: string, done: MessageKey) {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ tone: "success", title: t(done) });
  } catch {
    showToast({ tone: "error", title: t("twoFactor.copyFailed") });
  }
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
  await router.push({ name: "home" });
}
</script>

<template>
  <p class="text-fg-muted">{{ t("twoFactor.intro") }}</p>
  <UiAlert v-if="error" tone="error">{{ t(error) }}</UiAlert>

  <form
    v-if="step === 'password'"
    class="flex flex-col gap-5"
    @submit.prevent="start"
  >
    <h2 class="text-lg font-semibold">{{ t("twoFactor.stepPassword") }}</h2>
    <UiTextField
      v-model="password"
      :label="t('twoFactor.password')"
      type="password"
      autocomplete="current-password"
    />
    <UiButton type="submit" :loading="busy" class="w-full">
      {{ t("twoFactor.continue") }}
    </UiButton>
  </form>

  <ol
    v-else
    class="flex list-decimal flex-col gap-8 ps-6 marker:text-lg marker:font-semibold"
  >
    <li class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold">{{ t("twoFactor.stepScan") }}</h2>
      <img
        :src="qrDataUrl"
        :alt="t('twoFactor.qrAlt')"
        class="size-48 self-center rounded-md bg-white p-2"
      />
      <p class="text-sm text-fg-muted">{{ t("twoFactor.manualKey") }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <code
          data-testid="totp-key"
          class="rounded-md bg-surface-muted px-3 py-2 font-mono text-sm break-all"
        >
          {{ manualKey }}
        </code>
        <UiButton
          variant="ghost"
          size="sm"
          :icon="Copy"
          @click="copy(manualKey, 'twoFactor.keyCopied')"
        >
          {{ t("twoFactor.copyKey") }}
        </UiButton>
      </div>
    </li>

    <li class="flex flex-col gap-3">
      <h2 class="text-lg font-semibold">{{ t("twoFactor.stepBackup") }}</h2>
      <p class="text-sm text-fg-muted">{{ t("twoFactor.backupText") }}</p>
      <ul
        class="grid grid-cols-2 gap-2 rounded-md bg-surface-muted p-3 font-mono text-sm"
      >
        <li v-for="backup in backupCodes" :key="backup">{{ backup }}</li>
      </ul>
      <UiButton
        variant="ghost"
        size="sm"
        :icon="Copy"
        class="self-start"
        @click="copy(backupCodes.join('\n'), 'twoFactor.codesCopied')"
      >
        {{ t("twoFactor.copyCodes") }}
      </UiButton>
    </li>

    <li>
      <form class="flex flex-col gap-5" @submit.prevent="confirm">
        <h2 class="text-lg font-semibold">
          {{ t("twoFactor.stepConfirm") }}
        </h2>
        <UiTextField
          v-model="code"
          :label="t('twoFactor.code')"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          maxlength="6"
        />
        <UiButton type="submit" :loading="busy" class="w-full">
          {{ t("twoFactor.submit") }}
        </UiButton>
      </form>
    </li>
  </ol>
</template>
