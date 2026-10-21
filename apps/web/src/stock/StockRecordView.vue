<script setup lang="ts">
import {
  endpoints,
  Locale,
  RecordTransfer,
  RecordWaste,
  WASTE_REASONS,
  type FieldErrorCode,
  type Product,
  type Storeroom,
} from "@kitchen-ops/shared";
import { Plus } from "lucide-vue-next";
import { computed, onMounted, ref, shallowReactive } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRouter } from "vue-router";
import { ApiError, call } from "../api";
import { useForm } from "../catalogue/form";
import UiAlert from "../components/ui/UiAlert.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { showToast } from "../components/ui/toasts";
import { useT, type MessageKey } from "../i18n";
import { errorMessageKey, fieldMessageKey } from "../i18n/errors";
import { formatPrintedDecimal } from "../i18n/format";
import StockLineFields from "./StockLineFields.vue";
import {
  KITCHEN_UNIT,
  lineErrors,
  sendsOnce,
  stockLine,
  type LineValues,
} from "./record-form";

// Recording waste or a transfer (#151), on a phone first: a storeroom (and where a transfer
// goes), products found by typing with their quantities, and waste's reason and note. Checked by
// the API's own schema before sending, posted after a confirmation under one ID, so a send whose
// answer was lost posts once (decision 0044). A line the API refuses says why on its field;
// once posted, its page shows what moved.
const props = defineProps<{ type: "waste" | "transfer" }>();
const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));
const router = useRouter();

const emptyLine = (): LineValues => ({
  productId: "",
  quantity: "",
  unit: KITCHEN_UNIT,
});
interface Values extends Record<string, unknown> {
  storeroomId: string;
  toStoreroomId: string;
  reason: string;
  note: string;
  lines: LineValues[];
}

/** The products chosen, by ID: their units turn each line into what the API takes. */
const products = shallowReactive(new Map<string, Product>());

/** The body as the API takes it, for the schema to check and the API to post. */
function toBody(v: Values) {
  const lines = v.lines.map((l) => stockLine(l, products.get(l.productId)));
  return props.type === "waste"
    ? {
        storeroomId: v.storeroomId,
        reason: v.reason,
        ...(v.note.trim() ? { note: v.note } : {}),
        lines,
      }
    : { storeroomId: v.storeroomId, toStoreroomId: v.toStoreroomId, lines };
}

const form = useForm<typeof RecordWaste | typeof RecordTransfer, Values>(
  props.type === "waste" ? RecordWaste : RecordTransfer,
  {
    storeroomId: "",
    toStoreroomId: "",
    reason: "",
    note: "",
    lines: [emptyLine()],
  },
  {
    toBody,
    // What the schema can't see: a quantity that isn't whole base units, a transfer to where
    // it comes from.
    check: (): Record<string, FieldErrorCode> => ({
      ...lineErrors(form.values.lines, products),
      ...(props.type === "transfer" &&
      form.values.storeroomId &&
      form.values.toStoreroomId === form.values.storeroomId
        ? { toStoreroomId: "invalid" as const }
        : {}),
    }),
  },
);
const { values } = form;

/** A field's error, in words: a transfer's destination says what it must be. */
function error(field: string): string | undefined {
  const code = form.error(field);
  if (!code) return undefined;
  const own: Partial<Record<FieldErrorCode, MessageKey>> =
    field === "toStoreroomId"
      ? {
          invalid: "stock.record.toInvalid",
          not_found: "stock.record.toInvalid",
        }
      : {};
  return t(fieldMessageKey(code, own));
}
const lineError = (i: number) => ({
  productId: error(`lines.${i}.productId`),
  quantity: error(`lines.${i}.quantity`),
  unit: error(`lines.${i}.unit`),
});

const storerooms = ref<Storeroom[]>([]);
const storeroomsFailed = ref(false);
onMounted(async () => {
  try {
    storerooms.value = (
      await call(endpoints.listStorerooms, { query: { pageSize: 200 } })
    ).items;
  } catch {
    storeroomsFailed.value = true;
  }
});
const storeroomOptions = computed(() =>
  storerooms.value.map((s) => ({ value: s.id, label: s.name })),
);
const reasonOptions = computed(() =>
  WASTE_REASONS.map((value) => ({
    value,
    label: t(`stock.reasons.${value}`),
  })),
);
const nameOf = (id: string) =>
  storerooms.value.find((s) => s.id === id)?.name ?? "";

function addLine() {
  values.lines.push(emptyLine());
}
function removeLine(i: number) {
  values.lines.splice(i, 1);
}

/** A line as the confirmation lists it: "1,5 kg · Tomate pera". */
function lineText(line: LineValues): string {
  const product = products.get(line.productId);
  const unit =
    line.unit !== KITCHEN_UNIT
      ? line.unit
      : product?.baseUnit === "g"
        ? "kg"
        : product?.baseUnit === "ml"
          ? "l"
          : t("unitsShort.unit");
  return `${formatPrintedDecimal(line.quantity, language.value)} ${unit} · ${product?.name ?? ""}`;
}

const confirming = ref(false);
const posting = ref(false);
/** Posted already, under this page's ID, as first sent: its page has what was recorded. */
const conflict = ref<string>();

const recording = sendsOnce((id) => {
  const body = toBody(values);
  return props.type === "waste"
    ? call(endpoints.recordWaste, {
        params: { id },
        body: body as RecordWaste,
      })
    : call(endpoints.recordTransfer, {
        params: { id },
        body: body as RecordTransfer,
      });
});

/** Every field checked first; then the confirmation. */
async function review() {
  await form.submit(async () => {
    confirming.value = true;
  });
}

async function post() {
  posting.value = true;
  conflict.value = undefined;
  const id = recording.id;
  try {
    let answer: { id: string } | undefined;
    await form.submit(async () => {
      answer = await recording.send();
    });
    if (answer) {
      showToast({
        tone: "success",
        title: t(`stock.record.recorded.${props.type}`),
      });
      await router.push({ name: "stock-document", params: { id: answer.id } });
    }
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === "conflict") {
      conflict.value = id;
    } else {
      showToast({ tone: "error", title: t(errorMessageKey(caught)) });
    }
  } finally {
    confirming.value = false;
    posting.value = false;
  }
}
</script>

<template>
  <form
    class="flex max-w-2xl flex-col gap-6"
    novalidate
    @submit.prevent="review"
  >
    <UiAlert v-if="storeroomsFailed" tone="error">
      {{ t("stock.record.storeroomsFailed") }}
    </UiAlert>
    <UiAlert v-if="conflict" tone="warning">
      {{ t("stock.record.conflict") }}
      <RouterLink
        :to="{ name: 'stock-document', params: { id: conflict } }"
        class="font-medium text-primary underline underline-offset-4"
      >
        {{ t("stock.record.conflictLink") }}
      </RouterLink>
    </UiAlert>

    <div class="grid gap-4 sm:grid-cols-2">
      <UiSelect
        v-model="values.storeroomId"
        :options="storeroomOptions"
        :label="
          type === 'waste'
            ? t('stock.record.storeroom')
            : t('stock.record.from')
        "
        :error="error('storeroomId')"
        @update:model-value="form.touch('storeroomId')"
      />
      <UiSelect
        v-if="type === 'transfer'"
        v-model="values.toStoreroomId"
        :options="storeroomOptions"
        :label="t('stock.record.to')"
        :error="error('toStoreroomId')"
        @update:model-value="form.touch('toStoreroomId')"
      />
      <UiSelect
        v-if="type === 'waste'"
        v-model="values.reason"
        :options="reasonOptions"
        :label="t('stock.record.reason')"
        :error="error('reason')"
        @update:model-value="form.touch('reason')"
      />
    </div>
    <UiTextField
      v-if="type === 'waste'"
      v-model="values.note"
      :label="t('stock.record.note')"
      :hint="t('stock.record.noteHint')"
      :error="error('note')"
      optional
      autocomplete="off"
      @blur="form.touch('note')"
    />

    <ol class="flex flex-col gap-4">
      <li v-for="(line, i) in values.lines" :key="i">
        <StockLineFields
          :model-value="line"
          :n="i + 1"
          :errors="lineError(i)"
          :product="products.get(line.productId)"
          :removable="values.lines.length > 1"
          @update:model-value="(changed) => (values.lines[i] = changed)"
          @chosen="(p) => products.set(p.id, p)"
          @touch="(field) => form.touch(`lines.${i}.${field}`)"
          @remove="removeLine(i)"
        />
      </li>
    </ol>
    <div>
      <UiButton variant="secondary" :icon="Plus" @click="addLine">
        {{ t("stock.record.addLine") }}
      </UiButton>
    </div>

    <div>
      <UiButton type="submit">{{ t("stock.record.submit") }}</UiButton>
    </div>

    <UiDialog
      v-model:open="confirming"
      :title="t(`stock.record.confirmTitle.${type}`)"
      :description="t('stock.record.confirmText')"
    >
      <p class="font-medium">
        {{
          t(`stock.record.confirmFrom.${type}`, {
            from: nameOf(values.storeroomId),
            to: nameOf(values.toStoreroomId),
          })
        }}
      </p>
      <ul class="flex list-disc flex-col gap-1 pl-5 tabular">
        <li v-for="(line, i) in values.lines" :key="i">{{ lineText(line) }}</li>
      </ul>
      <template #footer="{ close }">
        <UiButton variant="secondary" @click="close">
          {{ t("catalogue.cancel") }}
        </UiButton>
        <UiButton :loading="posting" @click="post">
          {{ t("stock.record.submit") }}
        </UiButton>
      </template>
    </UiDialog>
  </form>
</template>
