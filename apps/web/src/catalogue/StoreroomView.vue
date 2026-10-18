<script setup lang="ts">
import {
  endpoints,
  NewStoreroom,
  STOREROOM_TYPES,
  type Storeroom,
} from "@kitchen-ops/shared";
import { computed } from "vue";
import { call } from "../api";
import UiBadge from "../components/ui/UiBadge.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { useT } from "../i18n";
import { fieldMessageKey } from "../i18n/errors";
import DeactivateDialog from "./DeactivateDialog.vue";
import { useCatalogueItem } from "./item";
import UnsavedDialog from "./UnsavedDialog.vue";

// A storeroom's page (#89): a new one's form, an existing one's form for office and owner, or
// its details for counter staff.
const props = defineProps<{ id?: string }>();
const t = useT();

const empty = { name: "", type: "" };
const page = useCatalogueItem({
  id: () => props.id,
  update: endpoints.updateStoreroom,
  schema: NewStoreroom,
  empty,
  valuesOf: (s: Storeroom) => ({ name: s.name, type: s.type as string }),
  load: (id) => call(endpoints.getStoreroom, { params: { id } }),
  create: (body) => call(endpoints.createStoreroom, { body }),
  save: (id, body) => call(endpoints.updateStoreroom, { params: { id }, body }),
  route: "storeroom",
  messages: {
    created: "storerooms.created",
    deactivated: "storerooms.deactivated",
    reactivated: "storerooms.reactivated",
  },
});
const { item, loading, loadError, canWrite, working, confirming, guard } = page;
const { values, error, touch, saving } = page.form;

const message = (field: keyof typeof empty) => {
  const code = error(field);
  return (
    code &&
    t(
      fieldMessageKey(
        code,
        field === "name" ? { taken: "storerooms.nameTaken" } : {},
      ),
    )
  );
};
const types = computed(() =>
  STOREROOM_TYPES.map((value) => ({
    value,
    label: t(`storerooms.types.${value}`),
  })),
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
        :label="t('storerooms.name')"
        :error="message('name')"
        autocomplete="off"
        @blur="touch('name')"
      />
      <UiSelect
        v-model="values.type"
        :options="types"
        :label="t('storerooms.type')"
        :error="message('type')"
        @update:model-value="touch('type')"
      />
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
          {{ id ? t("catalogue.saveChanges") : t("storerooms.create") }}
        </UiButton>
      </div>
    </form>

    <dl
      v-else-if="item"
      class="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[12rem_1fr]"
    >
      <dt class="font-medium text-fg-muted">{{ t("storerooms.type") }}</dt>
      <dd>{{ t(`storerooms.types.${item.type}`) }}</dd>
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
