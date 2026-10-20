<script setup lang="ts">
import {
  BASE_UNIT_FACTOR,
  endpoints,
  NewSupplierProduct,
  type Product,
  type SupplierProduct,
} from "@kitchen-ops/shared";
import { computed, onUnmounted, ref, watch } from "vue";
import { call } from "../api";
import UiButton from "../components/ui/UiButton.vue";
import UiCheckbox from "../components/ui/UiCheckbox.vue";
import UiCombobox from "../components/ui/UiCombobox.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiNumberField from "../components/ui/UiNumberField.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { showToast } from "../components/ui/toasts";
import { useT } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";
import { useForm } from "./form";
import { SEARCH_DELAY_MS } from "./list-query";
import { usePackText } from "./pack-text";
import { packBaseUnits } from "./units";
import UnsavedDialog from "./UnsavedDialog.vue";

// Adding or changing a supplier product (#89): the supplier's code and description, our product,
// found by typing (the API searches), and the pack in one of that product's units, with its live
// example. Deactivating is the "Activo" box, saved with the rest. Closing with changes asks first.
const props = defineProps<{ supplierId: string; editing?: SupplierProduct }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ saved: [] }>();
const t = useT();
const packText = usePackText();

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

/** Products seen, by ID: the picker's matches, and the one being edited. */
const known = ref(new Map<string, Product>());
const matches = ref<Product[]>([]);
const chosen = computed(() => known.value.get(values.productId));

let timer: ReturnType<typeof setTimeout> | undefined;
let asked = 0;
function search(text: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const mine = ++asked;
    try {
      const page = await call(endpoints.listProducts, {
        query: { q: text.trim() || undefined, pageSize: 20 },
      });
      if (mine !== asked) return;
      matches.value = page.items;
      for (const p of page.items) known.value.set(p.id, p);
    } catch {
      // The picker shows no matches; typing again tries again.
    }
  }, SEARCH_DELAY_MS);
}
onUnmounted(() => clearTimeout(timer));

// Opened: the form for a new supplier product, or the one being edited, with its product.
watch(open, async (isOpen) => {
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
  search("");
  if (s && !known.value.has(s.product.id)) {
    try {
      const product = await call(endpoints.getProduct, {
        params: { id: s.product.id },
      });
      known.value.set(product.id, product);
    } catch {
      // Its units can't be offered; the rest of the form still works.
    }
  }
});

const productOptions = computed(() =>
  matches.value.map((p) => ({ value: p.id, label: p.name })),
);
const productLabel = computed(
  () => chosen.value?.name ?? props.editing?.product.name ?? "",
);
/** The chosen product's units: its base unit, then its purchase units. */
const units = computed(() => {
  const p = chosen.value;
  if (!p) return [];
  return [
    {
      value: p.baseUnit,
      label: t(`unitsShort.${p.baseUnit}`),
      factor: BASE_UNIT_FACTOR[p.baseUnit],
    },
    ...p.conversions.map((c) => ({
      value: c.unit,
      label: c.unit,
      factor: c.factor,
    })),
  ];
});
// Another product: a unit it doesn't have is cleared.
watch(units, (list) => {
  if (list.length > 0 && !list.some((u) => u.value === values.pack.unit)) {
    values.pack.unit = "";
  }
});
const example = computed(() => {
  const unit = units.value.find((u) => u.value === values.pack.unit);
  const p = chosen.value;
  if (!unit || !p || !values.pack.quantity) return undefined;
  return packText(
    values.pack,
    p.baseUnit,
    packBaseUnits(values.pack.quantity, unit.factor),
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
      <UiCombobox
        v-model="values.productId"
        :label="t('supplierProducts.product')"
        :hint="t('supplierProducts.productHint')"
        :error="message('productId')"
        :options="productOptions"
        :selected-label="productLabel"
        remote
        @search="search"
        @update:model-value="touch('productId')"
      />
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-2 font-medium">
          {{ t("supplierProducts.pack") }}
        </legend>
        <div class="grid gap-4 sm:grid-cols-2">
          <UiNumberField
            v-model="values.pack.quantity"
            :label="t('supplierProducts.quantity')"
            :max-decimals="6"
            :error="message('pack.quantity')"
            @blur="touch('pack.quantity')"
          />
          <UiSelect
            v-model="values.pack.unit"
            :options="units"
            :label="t('supplierProducts.packUnit')"
            :placeholder="
              chosen ? undefined : t('supplierProducts.packUnitFirst')
            "
            :disabled="!chosen"
            :error="message('pack.unit')"
            @update:model-value="touch('pack.unit')"
          />
        </div>
        <p
          v-if="example"
          class="text-sm font-medium text-fg-muted tabular"
          aria-live="polite"
        >
          {{ example }}
        </p>
      </fieldset>
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
