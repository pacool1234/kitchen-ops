<script setup lang="ts">
import {
  endpoints,
  type DocumentMatching,
  type Supplier,
} from "@kitchen-ops/shared";
import { computed, onUnmounted, ref } from "vue";
import { call } from "../api";
import { SEARCH_DELAY_MS } from "../catalogue/list-query";
import UiBadge from "../components/ui/UiBadge.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiCombobox from "../components/ui/UiCombobox.vue";
import { showToast } from "../components/ui/toasts";
import { useT } from "../i18n";
import { errorMessageKey } from "../i18n/errors";
import NewSupplierDialog from "./NewSupplierDialog.vue";

// A document's supplier, in review (#117, #118, decision 0035): the one found by its tax ID, or
// chosen here from ours by typing, or created on the spot from what the document reads. Choosing
// one runs the checks again (its numbers already received), and its lines match its products.
const props = defineProps<{
  documentId: string;
  matching: DocumentMatching;
  /** The supplier as the draft reads it, to create one from. */
  read: { name: string; taxId: string };
}>();
const emit = defineEmits<{ chosen: [matching: DocumentMatching] }>();
const t = useT();

const changing = ref(false);
const creating = ref(false);
const choosing = computed(() => changing.value || !props.matching.supplier);

const matches = ref<Supplier[]>([]);
const picked = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
let asked = 0;
function search(text: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const mine = ++asked;
    try {
      const page = await call(endpoints.listSuppliers, {
        query: { q: text.trim() || undefined, pageSize: 20 },
      });
      if (mine === asked) matches.value = page.items;
    } catch {
      // The picker shows no matches; typing again tries again.
    }
  }, SEARCH_DELAY_MS);
}
onUnmounted(() => clearTimeout(timer));
const options = computed(() =>
  matches.value.map((s) => ({ value: s.id, label: s.name })),
);

async function choose(supplierId: string | undefined) {
  if (!supplierId) return;
  try {
    const matching = await call(endpoints.setDocumentSupplier, {
      params: { id: props.documentId },
      body: { supplierId },
    });
    changing.value = false;
    picked.value = "";
    emit("chosen", matching);
    showToast({ tone: "success", title: t("documents.matching.chosen") });
  } catch (caught) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  }
}
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"
    aria-labelledby="supplier-heading"
  >
    <h3 id="supplier-heading" class="font-semibold">
      {{ t("documents.matching.supplier") }}
    </h3>
    <div
      v-if="matching.supplier && !changing"
      class="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <p>
        <span class="font-medium">{{ matching.supplier.name }}</span>
        <span class="ms-2 text-fg-muted tabular">
          {{
            t("documents.matching.taxIdShown", {
              taxId: matching.supplier.taxId,
            })
          }}
        </span>
      </p>
      <UiBadge v-if="matching.newSupplier" tone="info">
        {{ t("documents.matching.newSupplier") }}
      </UiBadge>
      <UiButton variant="ghost" size="sm" @click="changing = true">
        {{ t("documents.matching.change") }}
      </UiButton>
    </div>
    <template v-if="choosing">
      <p v-if="!matching.supplier">{{ t("documents.matching.noSupplier") }}</p>
      <UiCombobox
        v-model="picked"
        :label="t('documents.matching.choose')"
        :hint="t('documents.matching.chooseHint')"
        :options="options"
        remote
        @search="search"
        @update:model-value="choose"
      />
      <div class="flex flex-wrap gap-2">
        <UiButton variant="secondary" @click="creating = true">
          {{ t("documents.matching.create") }}
        </UiButton>
        <UiButton v-if="changing" variant="ghost" @click="changing = false">
          {{ t("documents.matching.keep") }}
        </UiButton>
      </div>
    </template>
    <NewSupplierDialog
      v-model:open="creating"
      :name="read.name"
      :tax-id="read.taxId"
      @created="(supplier) => choose(supplier.id)"
    />
  </section>
</template>
