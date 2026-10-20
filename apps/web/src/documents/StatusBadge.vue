<script setup lang="ts">
import type { DocumentStatus } from "@kitchen-ops/shared";
import UiBadge from "../components/ui/UiBadge.vue";
import { useT } from "../i18n";

// A document's status (#106), in words; the colour only repeats them. A posted document that
// another one reverses says so (#119).
defineProps<{ status: DocumentStatus; reversed?: boolean }>();
const t = useT();

const tones = {
  queued: "neutral",
  reading: "info",
  ready_for_review: "success",
  failed: "danger",
  posted: "primary",
} as const;
</script>

<template>
  <UiBadge v-if="reversed" tone="neutral">{{
    t("documents.reversedStatus")
  }}</UiBadge>
  <UiBadge v-else :tone="tones[status]">{{
    t(`documents.statuses.${status}`)
  }}</UiBadge>
</template>
