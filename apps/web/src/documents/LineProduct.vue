<script setup lang="ts">
import type { LineMatch } from "@kitchen-ops/shared";
import { computed, useId } from "vue";
import { usePackText } from "../catalogue/pack-text";
import UiButton from "../components/ui/UiButton.vue";
import { useT } from "../i18n";

// A line's product, in review (#117, #118): its supplier product, found by code or by
// description; or the product a model suggested, to confirm; or none, to choose. Choosing waits
// for the document's supplier, and for the corrections to be saved; it says which.
const props = defineProps<{
  match: LineMatch | null;
  offered: boolean;
  blocked?: "no_supplier" | "unsaved";
}>();
const emit = defineEmits<{ choose: [] }>();
const t = useT();
const packText = usePackText();
const hintId = useId();

const matched = computed(() =>
  props.match && props.match.by !== "suggestion" ? props.match : undefined,
);
const suggested = computed(() =>
  props.match?.by === "suggestion" ? props.match.product : undefined,
);
</script>

<template>
  <div class="flex flex-col gap-2 border-t border-line pt-3 text-sm">
    <p v-if="matched">
      <span class="text-fg-muted">{{ t("documents.matching.product") }}:</span>
      {{ " " }}
      <span class="font-medium">{{
        matched.supplierProduct.product.name
      }}</span>
      ·
      {{
        packText(
          matched.supplierProduct.pack,
          matched.supplierProduct.product.baseUnit,
          matched.supplierProduct.packBaseUnits,
        )
      }}
      <span class="text-fg-muted">
        ({{
          t(
            matched.by === "code"
              ? "documents.matching.byCode"
              : "documents.matching.byDescription",
          )
        }})
      </span>
    </p>
    <template v-else>
      <p>
        {{
          suggested
            ? t("documents.matching.suggested", { name: suggested.name })
            : t("documents.matching.noProduct")
        }}
      </p>
      <div class="flex flex-wrap items-center gap-3">
        <UiButton
          variant="secondary"
          size="sm"
          :disabled="!offered"
          :aria-describedby="blocked ? hintId : undefined"
          @click="emit('choose')"
        >
          {{
            t(
              suggested
                ? "documents.matching.confirm"
                : "documents.matching.chooseProduct",
            )
          }}
        </UiButton>
        <p v-if="blocked" :id="hintId" class="text-fg-muted">
          {{ t(`documents.matching.blocked.${blocked}`) }}
        </p>
      </div>
    </template>
  </div>
</template>
