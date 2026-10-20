<script setup lang="ts">
import { endpoints, NewSupplier, type Supplier } from "@kitchen-ops/shared";
import { watch } from "vue";
import { call } from "../api";
import { useForm } from "../catalogue/form";
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { showToast } from "../components/ui/toasts";
import { useT } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";

// A supplier created on the spot, in review (#118): its name and tax ID as the document reads
// them, to check and change. The contact details can be added later in the catalogue.
const props = defineProps<{ name: string; taxId: string }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ created: [supplier: Supplier] }>();
const t = useT();

const form = useForm(NewSupplier, { name: "", taxId: "" });
const { values, error, touch, saving } = form;

// Opened: what the document reads.
watch(open, (isOpen) => {
  if (isOpen) form.reset({ name: props.name, taxId: props.taxId });
});

const message = (field: string) => {
  const code = error(field);
  return (
    code &&
    t(
      fieldMessageKey(
        code,
        field === "taxId" ? { taken: "suppliers.taxIdTaken" } : {},
      ),
    )
  );
};

async function create() {
  try {
    await form.submit(async (body) => {
      const supplier = await call(endpoints.createSupplier, { body });
      open.value = false;
      emit("created", supplier);
    });
  } catch (caught) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  }
}
</script>

<template>
  <UiDialog v-model:open="open" :title="t('documents.matching.create')">
    <form
      id="new-supplier-form"
      novalidate
      class="flex flex-col gap-4"
      @submit.prevent="create"
    >
      <UiTextField
        v-model="values.name"
        :label="t('suppliers.name')"
        :error="message('name')"
        autocomplete="off"
        @blur="touch('name')"
      />
      <UiTextField
        v-model="values.taxId"
        :label="t('suppliers.taxId')"
        :error="message('taxId')"
        autocomplete="off"
        @blur="touch('taxId')"
      />
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="open = false">
        {{ t("catalogue.cancel") }}
      </UiButton>
      <UiButton type="submit" form="new-supplier-form" :loading="saving">
        {{ t("documents.matching.createAndChoose") }}
      </UiButton>
    </template>
  </UiDialog>
</template>
