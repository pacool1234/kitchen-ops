<script setup lang="ts">
import {
  endpoints,
  NewSupplierProduct,
  type SupplierProduct,
} from "@kitchen-ops/shared";
import { computed, ref, watch } from "vue";
import { call } from "../api";
import UiButton from "../components/ui/UiButton.vue";
import UiCheckbox from "../components/ui/UiCheckbox.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { showToast } from "../components/ui/toasts";
import { useT } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";
import { useForm } from "./form";
import ProductPackFields from "./ProductPackFields.vue";
import UnsavedDialog from "./UnsavedDialog.vue";

// Adding or changing a supplier product (#89): the supplier's code and description, our product,
// found by typing (the API searches), and the pack in one of that product's units, with its live
// example. Deactivating is the "Activo" box, saved with the rest. Closing with changes asks first.
const props = defineProps<{ supplierId: string; editing?: SupplierProduct }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ saved: [] }>();
const t = useT();

const empty = {
  code: "",
  description: "",
  productId: "",
  pack: { quantity: "", unit: "" },
  active: true as boolean | "indeterminate",
};
type Values = typeof empty;
const form = useForm(NewSupplierProduct, empty, {
  // `active` is saved with a change, not checked as part of a new one.
  toBody: (v: Values) => ({
    supplierId: props.supplierId,
    code: v.code,
    description: v.description,
    productId: v.productId,
    pack: v.pack,
  }),
});
const { values, error, touch, saving, dirty } = form;

// Opened: the form for a new supplier product, or the one being edited, with its product.
watch(open, (isOpen) => {
  if (!isOpen) return;
  const s = props.editing;
  form.reset(
    s
      ? {
          code: s.code ?? "",
          description: s.description,
          productId: s.product.id,
          pack: { ...s.pack },
          active: s.active,
        }
      : empty,
  );
});

const message = (field: string) => {
  const code = error(field);
  return (
    code &&
    t(
      fieldMessageKey(
        code,
        field === "code" ? { taken: "supplierProducts.codeTaken" } : {},
      ),
    )
  );
};

// Closing with changes asks first; staying keeps them.
const asking = ref(false);
const shown = computed({
  get: () => open.value,
  set: (value: boolean) => {
    if (!value && dirty.value) asking.value = true;
    else open.value = value;
  },
});
function leave() {
  asking.value = false;
  form.reset(empty);
  open.value = false;
}

async function save() {
  try {
    const saved = await form.submit(async (body) => {
      const s = props.editing;
      if (s) {
        await call(endpoints.updateSupplierProduct, {
          params: { id: s.id },
          body: {
            code: body.code,
            description: body.description,
            productId: body.productId,
            pack: body.pack,
            active: values.active === true,
          },
        });
      } else {
        await call(endpoints.createSupplierProduct, { body });
      }
      showToast({
        tone: "success",
        title: t(s ? "catalogue.saved" : "supplierProducts.added"),
      });
      form.reset(empty);
      open.value = false;
      emit("saved");
    });
    if (!saved) {
      document
        .querySelector<HTMLElement>("[role='dialog'] [aria-invalid='true']")
        ?.focus();
    }
  } catch (caught) {
    showToast({ tone: "error", title: t(errorMessageKey(caught)) });
  }
}
</script>

<template>
  <UiDialog
    v-model:open="shown"
    :title="
      editing
        ? t('supplierProducts.edit', {
            name: editing.code ?? editing.description,
          })
        : t('supplierProducts.addTitle')
    "
  >
    <form
      id="supplier-product-form"
      novalidate
      class="flex flex-col gap-4"
      @submit.prevent="save"
    >
      <div class="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <UiTextField
          v-model="values.code"
          :label="t('supplierProducts.code')"
          :hint="t('supplierProducts.codeHint')"
          :error="message('code')"
          autocomplete="off"
          @blur="touch('code')"
        />
        <UiTextField
          v-model="values.description"
          :label="t('supplierProducts.description')"
          :hint="t('supplierProducts.descriptionHint')"
          :error="message('description')"
          autocomplete="off"
          @blur="touch('description')"
        />
      </div>
      <ProductPackFields
        v-model:product-id="values.productId"
        v-model:pack="values.pack"
        :selected-name="editing?.product.name"
        :errors="{
          productId: message('productId'),
          quantity: message('pack.quantity'),
          unit: message('pack.unit'),
        }"
        @touch="touch"
      />
      <UiCheckbox
        v-if="editing"
        v-model="values.active"
        :label="t('supplierProducts.active')"
        :hint="t('supplierProducts.activeHint')"
      />
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="shown = false">
        {{ t("catalogue.cancel") }}
      </UiButton>
      <UiButton type="submit" form="supplier-product-form" :loading="saving">
        {{ t("supplierProducts.save") }}
      </UiButton>
    </template>
    <UnsavedDialog
      v-model:open="asking"
      @stay="asking = false"
      @leave="leave"
    />
  </UiDialog>
</template>
