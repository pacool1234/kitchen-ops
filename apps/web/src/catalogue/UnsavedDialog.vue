<script setup lang="ts">
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import { useT } from "../i18n";

// Asked when leaving a changed form (#89): staying is the default, and what Escape does.
const open = defineModel<boolean>("open", { required: true });
defineEmits<{ stay: []; leave: [] }>();
const t = useT();
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="t('catalogue.unsaved.title')"
    :description="t('catalogue.unsaved.text')"
  >
    <template #footer>
      <UiButton variant="secondary" @click="$emit('leave')">
        {{ t("catalogue.unsaved.leave") }}
      </UiButton>
      <UiButton @click="$emit('stay')">
        {{ t("catalogue.unsaved.stay") }}
      </UiButton>
    </template>
  </UiDialog>
</template>
