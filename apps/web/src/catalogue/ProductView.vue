<script setup lang="ts">
import {
  BASE_UNITS,
  checkConversions,
  endpoints,
  Locale,
  NewProduct,
  PRODUCT_CATEGORIES,
  type BaseUnit,
  type Product,
  type ProductCategory,
  type Storeroom,
} from "@kitchen-ops/shared";
import { Plus, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { call } from "../api";
import UiAlert from "../components/ui/UiAlert.vue";
import UiBadge from "../components/ui/UiBadge.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import UiNumberField from "../components/ui/UiNumberField.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { useT } from "../i18n";
import { fieldMessageKey } from "../i18n/errors";
import { formatQuantity } from "../i18n/format";
import DeactivateDialog from "./DeactivateDialog.vue";
import { useCatalogueItem } from "./item";
import ProductSuppliers from "./ProductSuppliers.vue";
import UnsavedDialog from "./UnsavedDialog.vue";
import { amountToFactor, factorToAmount } from "./units";

// A product's page (#89): a new one's form, an existing one's form for office and owner, or its
// details for counter staff, and the supplier products that sell it. Its purchase units are
// edited in place, their sizes typed in kilos, litres or units, each with a live example.
const props = defineProps<{ id?: string }>();
const t = useT();
const { locale } = useI18n();

/** A purchase unit's row as typed; `key` keeps each row's fields its own as rows go. */
interface Row {
  key: number;
  unit: string;
  amount: string;
}
let nextKey = 0;
const row = (unit = "", amount = ""): Row => ({ key: nextKey++, unit, amount });

/** No usual storeroom: Reka's select can't hold an empty value. */
const NONE = "none";
const empty = {
  name: "",
  baseUnit: "" as BaseUnit | "",
  category: "" as ProductCategory | "",
  defaultStoreroomId: NONE,
  conversions: [] as Row[],
};
type Values = typeof empty;

const valuesOf = (p: Product): Values => ({
  name: p.name,
  baseUnit: p.baseUnit,
  category: p.category,
  defaultStoreroomId: p.defaultStoreroomId ?? NONE,
  conversions: p.conversions.map((c) => row(c.unit, factorToAmount(c.factor))),
});

/** The API's body: sizes in base units, "none" as null. */
const toBody = (v: Values) => ({
  name: v.name,
  baseUnit: v.baseUnit,
  category: v.category,
  defaultStoreroomId:
    v.defaultStoreroomId === NONE ? null : v.defaultStoreroomId,
  conversions: v.conversions.map((r) => ({
    unit: r.unit,
    factor: amountToFactor(r.amount),
  })),
});
type Body = ReturnType<typeof toBody>;

const page = useCatalogueItem({
  id: () => props.id,
  update: endpoints.updateProduct,
  schema: NewProduct,
  empty,
  valuesOf,
  form: {
    toBody,
    // What the schema can't see: a unit twice, or named after the base unit.
    check: (body: Body) =>
      BASE_UNITS.includes(body.baseUnit as BaseUnit)
        ? checkConversions(
            body.baseUnit as BaseUnit,
            body.conversions.map((c) => ({
              unit: c.unit.trim(),
              factor: c.factor ?? 0,
            })),
          )
        : {},
  },
  load: (id) => call(endpoints.getProduct, { params: { id } }),
  create: (body) => call(endpoints.createProduct, { body }),
  // The base unit never changes, so it's never sent again.
  save: (id, body) =>
    call(endpoints.updateProduct, {
      params: { id },
      body:
        "active" in body
          ? body
          : {
              name: body.name,
              category: body.category,
              defaultStoreroomId: body.defaultStoreroomId,
              conversions: body.conversions,
            },
    }),
  route: "product",
  messages: {
    created: "products.created",
    deactivated: "products.deactivated",
    reactivated: "products.reactivated",
  },
});
const { item, loading, loadError, canWrite, working, confirming, guard } = page;
const { values, error, touch, saving } = page.form;

const message = (field: string) => {
  const code = error(field);
  return (
    code &&
    t(
      fieldMessageKey(
        code,
        field === "name" ? { taken: "products.nameTaken" } : {},
      ),
    )
  );
};
/** What the API said about the list as a whole: a unit a pack uses, removed. */
const listMessage = computed(() => {
  const code = error("conversions");
  return code === "in_use"
    ? t("products.conversionInUse")
    : code && t(fieldMessageKey(code));
});

const storerooms = ref<Storeroom[]>([]);
onMounted(async () => {
  try {
    storerooms.value = (
      await call(endpoints.listStorerooms, { query: { pageSize: 200 } })
    ).items;
  } catch {
    // Only "none" to choose; saving still works.
  }
});
const storeroomOptions = computed(() => [
  { value: NONE, label: t("products.noStoreroom") },
  ...storerooms.value.map((s) => ({ value: s.id, label: s.name })),
]);
const baseUnits = computed(() =>
  BASE_UNITS.map((value) => ({ value, label: t(`units.${value}`) })),
);
const categories = computed(() =>
  PRODUCT_CATEGORIES.map((value) => ({
    value,
    label: t(`products.categories.${value}`),
  })),
);

/** "1 caja = 6 kg", once the row's size and the base unit are known. */
function example(unit: string, factor: number | undefined): string | undefined {
  const baseUnit = values.baseUnit;
  if (!unit.trim() || !factor || !baseUnit) return undefined;
  return t("products.example", {
    unit: unit.trim(),
    quantity: formatQuantity(factor, baseUnit, Locale.parse(locale.value)),
  });
}
const rowName = (r: Row, i: number) =>
  r.unit.trim() || t("products.conversion", { n: i + 1 });
const largeUnit = computed(() =>
  values.baseUnit ? t(`unitsLarge.${values.baseUnit}`) : "",
);
const storeroomName = computed(
  () =>
    storerooms.value.find((s) => s.id === item.value?.defaultStoreroomId)
      ?.name ?? t("products.noStoreroom"),
);
</script>

<template>
  <UiLoadingState v-if="loading" />
  <UiErrorState v-else-if="loadError" :message="t(loadError)" />
  <div v-else class="flex flex-col gap-8">
    <div class="flex max-w-2xl flex-col gap-6">
      <div v-if="item && !item.active" class="flex items-center gap-3">
        <UiBadge tone="warning">{{ t("catalogue.inactive") }}</UiBadge>
        <UiButton
          v-if="canWrite"
          variant="secondary"
          size="sm"
          :loading="working"
          @click="page.setActive(true)"
        >
          {{ t("catalogue.reactivate") }}
        </UiButton>
      </div>

      <form
        v-if="canWrite"
        novalidate
        class="flex flex-col gap-4"
        @submit.prevent="page.save"
      >
        <UiTextField
          v-model="values.name"
          :label="t('products.name')"
          :error="message('name')"
          autocomplete="off"
          @blur="touch('name')"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <UiSelect
            v-if="!id"
            v-model="values.baseUnit"
            :options="baseUnits"
            :label="t('products.baseUnit')"
            :hint="t('products.baseUnitHint')"
            :error="message('baseUnit')"
            @update:model-value="touch('baseUnit')"
          />
          <div v-else class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">{{
              t("products.baseUnit")
            }}</span>
            <span class="flex min-h-11 items-center">
              {{ values.baseUnit && t(`units.${values.baseUnit}`) }}
            </span>
            <span class="text-sm text-fg-muted">
              {{ t("products.baseUnitFixed") }}
            </span>
          </div>
          <UiSelect
            v-model="values.category"
            :options="categories"
            :label="t('products.category')"
            :error="message('category')"
            @update:model-value="touch('category')"
          />
        </div>
        <UiSelect
          v-model="values.defaultStoreroomId"
          :options="storeroomOptions"
          :label="t('products.storeroom')"
          :error="message('defaultStoreroomId')"
        />

        <fieldset class="flex flex-col gap-3">
          <legend class="text-lg font-semibold">
            {{ t("products.conversions") }}
          </legend>
          <p class="text-sm text-fg-muted">
            {{
              values.baseUnit
                ? t("products.conversionsHint", { unit: largeUnit })
                : t("products.baseUnitHint")
            }}
          </p>
          <UiAlert v-if="listMessage" tone="error">{{ listMessage }}</UiAlert>
          <fieldset
            v-for="(r, i) in values.conversions"
            :key="r.key"
            class="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
          >
            <legend class="sr-only">
              {{ t("products.conversion", { n: i + 1 }) }}
            </legend>
            <div class="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <UiTextField
                v-model="r.unit"
                :label="t('products.unit')"
                :error="message(`conversions.${i}.unit`)"
                autocomplete="off"
                @blur="touch(`conversions.${i}.unit`)"
              />
              <UiNumberField
                v-model="r.amount"
                :label="t('products.amount')"
                :unit="largeUnit"
                :max-decimals="3"
                :error="message(`conversions.${i}.factor`)"
                @blur="touch(`conversions.${i}.factor`)"
              />
              <UiButton
                variant="ghost"
                class="sm:mt-7"
                :aria-label="
                  t('products.removeConversion', { unit: rowName(r, i) })
                "
                @click="values.conversions.splice(i, 1)"
              >
                <Trash2 class="size-4" aria-hidden="true" />
              </UiButton>
            </div>
            <p
              v-if="example(r.unit, amountToFactor(r.amount))"
              class="text-sm font-medium text-fg-muted tabular"
            >
              {{ example(r.unit, amountToFactor(r.amount)) }}
            </p>
          </fieldset>
          <div>
            <UiButton
              variant="secondary"
              size="sm"
              :icon="Plus"
              @click="values.conversions.push(row())"
            >
              {{ t("products.addConversion") }}
            </UiButton>
          </div>
        </fieldset>

        <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <UiButton
            v-if="item?.active"
            variant="ghost"
            @click="confirming = true"
          >
            {{ t("catalogue.deactivate") }}
          </UiButton>
          <span v-else />
          <UiButton type="submit" :loading="saving">
            {{ id ? t("catalogue.saveChanges") : t("products.create") }}
          </UiButton>
        </div>
      </form>

      <dl
        v-else-if="item"
        class="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[12rem_1fr]"
      >
        <dt class="font-medium text-fg-muted">{{ t("products.category") }}</dt>
        <dd>{{ t(`products.categories.${item.category}`) }}</dd>
        <dt class="font-medium text-fg-muted">{{ t("products.baseUnit") }}</dt>
        <dd>{{ t(`units.${item.baseUnit}`) }}</dd>
        <dt class="font-medium text-fg-muted">{{ t("products.storeroom") }}</dt>
        <dd>{{ storeroomName }}</dd>
        <dt class="font-medium text-fg-muted">
          {{ t("products.conversions") }}
        </dt>
        <dd>
          <ul v-if="item.conversions.length > 0" class="flex flex-col gap-1">
            <li v-for="c in item.conversions" :key="c.unit" class="tabular">
              {{ example(c.unit, c.factor) }}
            </li>
          </ul>
          <template v-else>
            {{
              t("products.noConversions", { unit: t(`units.${item.baseUnit}`) })
            }}
          </template>
        </dd>
      </dl>
    </div>

    <ProductSuppliers v-if="item" :product="item" />

    <DeactivateDialog
      v-if="item"
      v-model:open="confirming"
      :name="item.name"
      :working="working"
      @confirm="page.setActive(false)"
    />
    <UnsavedDialog
      v-model:open="guard.asking.value"
      @stay="guard.stay"
      @leave="guard.leave"
    />
  </div>
</template>
