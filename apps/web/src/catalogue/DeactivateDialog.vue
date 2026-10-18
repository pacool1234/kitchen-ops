<script setup lang="ts">
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import { useT } from "../i18n";

// Deactivating asks first (#89): what it does, and that nothing is lost.
defineProps<{ name: string; working?: boolean }>();
const open = defineModel<boolean>("open", { required: true });
defineEmits<{ confirm: [] }>();
const t = useT();
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="t('catalogue.deactivateTitle', { name })"
    :description="t('catalogue.deactivateText')"
  >
    <template #footer="{ close }">
      <UiButton variant="secondary" @click="close">
        {{ t("catalogue.cancel") }}
      </UiButton>
      <UiButton variant="danger" :loading="working" @click="$emit('confirm')">
        {{ t("catalogue.deactivate") }}
      </UiButton>
    </template>
  </UiDialog>
</template>
