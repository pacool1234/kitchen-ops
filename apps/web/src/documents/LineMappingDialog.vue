<script setup lang="ts">
import {
  endpoints,
  NewMapping,
  type DocumentMatching,
} from "@kitchen-ops/shared";
import { ref, watch } from "vue";
import { ApiError, call } from "../api";
import { useForm } from "../catalogue/form";
import ProductPackFields from "../catalogue/ProductPackFields.vue";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";

// A line remembered as one of our products, in review (#117, #118, decision 0035): the product,
// the one a model suggested to begin with (decision 0036), and what the line's unit holds. Its
// code and description are the saved line's own; the supplier's next documents match it.
const props = defineProps<{
  documentId: string;
  /** The line, from 1. */
  line: number;
  /** The line as saved, to say which it is: "T-01 · Tomate pera". */
  lineText: string;
  suggested?: { id: string; name: string };
}>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ mapped: [matching: DocumentMatching] }>();
const t = useT();

const empty = { productId: "", pack: { quantity: "", unit: "" } };
const form = useForm(NewMapping, empty);
const { values, error, touch, saving } = form;
/** Why the API refused the line itself: its code or description, taken or missing. */
const refusal = ref<MessageKey>();

watch(open, (isOpen) => {
  if (!isOpen) return;
  refusal.value = undefined;
  form.reset({ ...empty, productId: props.suggested?.id ?? "" });
});

/** The line's code or description, which aren't fields here, refused: said in words. */
class LineRefused extends Error {
  readonly key: MessageKey;
  constructor(key: MessageKey) {
    super(key);
    this.key = key;
  }
}
function lineRefusal(caught: unknown): MessageKey | undefined {
  if (!(caught instanceof ApiError) || !caught.fields) return undefined;
  const { code, description } = caught.fields;
  if (code === "taken") return "documents.matching.codeTaken";
  if (description === "taken") return "documents.matching.descriptionTaken";
  if (description) return "documents.matching.descriptionRequired";
  return undefined;
}

const message = (field: string) => {
  const code = error(field);
  return code && t(fieldMessageKey(code));
};

async function save() {
  refusal.value = undefined;
  try {
    await form.submit(async (body) => {
      try {
        const matching = await call(endpoints.createLineMapping, {
          params: { id: props.documentId, line: String(props.line) },
          body,
        });
        open.value = false;
        emit("mapped", matching);
        showToast({ tone: "success", title: t("documents.matching.mapped") });
      } catch (caught) {
        const key = lineRefusal(caught);
        throw key ? new LineRefused(key) : caught;
      }
    });
  } catch (caught) {
    if (caught instanceof LineRefused) refusal.value = caught.key;
    else showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  }
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="t('documents.matching.lineTitle', { n: line })"
    :description="t('documents.matching.lineRead', { text: lineText })"
  >
    <form
      id="line-mapping-form"
      novalidate
      class="flex flex-col gap-4"
      @submit.prevent="save"
    >
      <UiAlert v-if="refusal" tone="error">{{ t(refusal) }}</UiAlert>
      <ProductPackFields
        v-model:product-id="values.productId"
        v-model:pack="values.pack"
        :selected-name="suggested?.name"
        :errors="{
          productId: message('productId'),
          quantity: message('pack.quantity'),
          unit: message('pack.unit'),
        }"
        @touch="touch"
      />
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="open = false">
        {{ t("catalogue.cancel") }}
      </UiButton>
      <UiButton type="submit" form="line-mapping-form" :loading="saving">
        {{ t("supplierProducts.save") }}
      </UiButton>
    </template>
  </UiDialog>
</template>
