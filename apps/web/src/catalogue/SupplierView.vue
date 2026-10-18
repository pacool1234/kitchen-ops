<script setup lang="ts">
import {
  checkSpanishTaxId,
  endpoints,
  NewSupplier,
  normalizeTaxId,
  type Supplier,
} from "@kitchen-ops/shared";
import { computed } from "vue";
import { call } from "../api";
import UiBadge from "../components/ui/UiBadge.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { useT } from "../i18n";
import { fieldMessageKey } from "../i18n/errors";
import DeactivateDialog from "./DeactivateDialog.vue";
import { useCatalogueItem } from "./item";
import UnsavedDialog from "./UnsavedDialog.vue";

// A supplier's page (#89): a new one's form, an existing one's form for office and owner, or its
// details for counter staff. The tax ID is checked as it's typed, by the same rule the API uses.
const props = defineProps<{ id?: string }>();
const t = useT();

const empty = { name: "", taxId: "", contactName: "", email: "", phone: "" };
const valuesOf = (s: Supplier) => ({
  name: s.name,
  taxId: s.taxId,
  contactName: s.contactName ?? "",
  email: s.email ?? "",
  phone: s.phone ?? "",
});

const page = useCatalogueItem({
  id: () => props.id,
  update: endpoints.updateSupplier,
  schema: NewSupplier,
  empty,
  valuesOf,
  load: (id) => call(endpoints.getSupplier, { params: { id } }),
  create: (body) => call(endpoints.createSupplier, { body }),
  save: (id, body) => call(endpoints.updateSupplier, { params: { id }, body }),
  route: "supplier",
  messages: {
    created: "suppliers.created",
    deactivated: "suppliers.deactivated",
    reactivated: "suppliers.reactivated",
  },
});
const { item, loading, loadError, canWrite, working, confirming, guard } = page;
const { values, error, touch, saving } = page.form;

type Field = keyof typeof empty;
const message = (field: Field) => {
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

// As it's typed: an error once the ID is long enough to be whole, and its kind once it's valid.
function onTaxIdInput() {
  if (normalizeTaxId(values.taxId).length >= 9) touch("taxId");
}
const taxIdKind = computed(() => {
  const check = checkSpanishTaxId(normalizeTaxId(values.taxId));
  return check.valid ? check.kind : undefined;
});
const taxIdHint = computed(() =>
  taxIdKind.value && !message("taxId")
    ? t("suppliers.taxIdValid", { kind: taxIdKind.value })
    : t("suppliers.taxIdHint"),
);

const details = computed(() =>
  item.value
    ? [
        { term: t("suppliers.taxId"), value: item.value.taxId },
        { term: t("suppliers.contactName"), value: item.value.contactName },
        { term: t("suppliers.email"), value: item.value.email },
        { term: t("suppliers.phone"), value: item.value.phone },
      ]
    : [],
);
</script>

<template>
  <UiLoadingState v-if="loading" />
  <UiErrorState v-else-if="loadError" :message="t(loadError)" />
  <div v-else class="flex max-w-2xl flex-col gap-6">
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
        :label="t('suppliers.name')"
        :error="message('name')"
        autocomplete="organization"
        @blur="touch('name')"
      />
      <UiTextField
        v-model="values.taxId"
        :label="t('suppliers.taxId')"
        :hint="taxIdHint"
        :error="message('taxId')"
        autocomplete="off"
        spellcheck="false"
        @input="onTaxIdInput"
        @blur="touch('taxId')"
      />
      <UiTextField
        v-model="values.contactName"
        :label="t('suppliers.contactName')"
        :error="message('contactName')"
        optional
        autocomplete="off"
        @blur="touch('contactName')"
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <UiTextField
          v-model="values.email"
          type="email"
          :label="t('suppliers.email')"
          :error="message('email')"
          optional
          autocomplete="off"
          @blur="touch('email')"
        />
        <UiTextField
          v-model="values.phone"
          type="tel"
          :label="t('suppliers.phone')"
          :error="message('phone')"
          optional
          autocomplete="off"
          @blur="touch('phone')"
        />
      </div>
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
          {{ id ? t("catalogue.saveChanges") : t("suppliers.create") }}
        </UiButton>
      </div>
    </form>

    <dl
      v-else-if="item"
      class="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[12rem_1fr]"
    >
      <template v-for="detail in details" :key="detail.term">
        <dt class="font-medium text-fg-muted">{{ detail.term }}</dt>
        <dd class="break-words">{{ detail.value || "—" }}</dd>
      </template>
    </dl>

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
