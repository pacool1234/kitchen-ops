<script setup lang="ts">
import type { DocumentStatus } from "@kitchen-ops/shared";
import UiBadge from "../components/ui/UiBadge.vue";
import { useT } from "../i18n";

// A document's status (#106), in words; the colour only repeats them.
defineProps<{ status: DocumentStatus }>();
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
  <UiBadge :tone="tones[status]">{{
    t(`documents.statuses.${status}`)
  }}</UiBadge>
</template>
