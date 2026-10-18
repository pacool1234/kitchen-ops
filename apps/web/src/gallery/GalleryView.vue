<script setup lang="ts">
import { Locale } from "@kitchen-ops/shared";
import { Plus, Truck } from "lucide-vue-next";
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import UiBadge from "../components/ui/UiBadge.vue";
import UiButton from "../components/ui/UiButton.vue";
import UiCard from "../components/ui/UiCard.vue";
import UiCheckbox from "../components/ui/UiCheckbox.vue";
import UiCombobox from "../components/ui/UiCombobox.vue";
import UiDataTable, { type Column } from "../components/ui/UiDataTable.vue";
import UiDialog from "../components/ui/UiDialog.vue";
import UiEmptyState from "../components/ui/UiEmptyState.vue";
import UiErrorState from "../components/ui/UiErrorState.vue";
import UiLoadingState from "../components/ui/UiLoadingState.vue";
import UiNumberField from "../components/ui/UiNumberField.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiSwitch from "../components/ui/UiSwitch.vue";
import UiTabs from "../components/ui/UiTabs.vue";
import UiTextField from "../components/ui/UiTextField.vue";
import { pageRows, sortRows, type Sort } from "../components/ui/table";
import { showToast } from "../components/ui/toasts";
import { useT } from "../i18n";
import { formatQuantity, formatUnitCost } from "../i18n/format";
import GallerySection from "./GallerySection.vue";
import { sampleProducts, type SampleProduct } from "./sample";

// The component gallery (#85, decision 0024): every component in every state, in light and
// dark, for reviewing the design system and for the browser tests' keyboard and axe checks.
// In development and browser-test builds only. Its own text is Spanish, like the interface,
// and not translated: the components' own text follows the language menu.

const t = useT();
const { locale } = useI18n();
const language = computed(() => Locale.parse(locale.value));

// Light, dark, or the system's: forces color-scheme on the page (src/design/base.css).
const theme = ref("system");
watch(theme, (value) => {
  if (value === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
});
onUnmounted(() => delete document.documentElement.dataset.theme);

const pressed = ref(0);

const productName = ref("");
const email = ref("pedidos@example.test");
const supplier = ref("");
const notes = ref("");
const code = ref("P-0042");

const quantity = ref("");
const price = ref("1.85");
const adjustment = ref("-0.5");

const baseUnit = ref<string>();
const storeroom = ref<string>();
const unitOptions = [
  { value: "g", label: "Gramos" },
  { value: "ml", label: "Mililitros" },
  { value: "unit", label: "Unidades" },
];
const storeroomOptions = [
  { value: "kitchen", label: "Cocina" },
  { value: "cold", label: "Cámara frigorífica" },
  { value: "dry", label: "Almacén seco" },
  { value: "bar", label: "Barra", disabled: true },
];

const product = ref<string>();
const productOptions = sampleProducts
  .map((p) => ({ value: p.id, label: p.name }))
  .sort((a, b) => a.label.localeCompare(b.label, "es"));

const active = ref<boolean | "indeterminate">(false);
const soldByUnit = ref<boolean | "indeterminate">(true);
const allStorerooms = ref<boolean | "indeterminate">("indeterminate");
const lowStockAlert = ref(false);
const autoOrder = ref(true);

const dialogOpen = ref(false);
function confirmDelete() {
  dialogOpen.value = false;
  showToast({ tone: "success", title: "Producto eliminado" });
}

const tab = ref("general");
const tabs = [
  { value: "general", label: "General" },
  { value: "units", label: "Unidades" },
  { value: "history", label: "Historial", disabled: true },
  { value: "suppliers", label: "Proveedores" },
];

const tableState = ref("data");
const tableStates = [
  { value: "data", label: "Con datos" },
  { value: "loading", label: "Cargando" },
  { value: "empty", label: "Vacía" },
  { value: "error", label: "Con un error" },
];
const sort = ref<Sort | null>(null);
const page = ref(1);
const PAGE_SIZE = 10;
const columns = computed<Column<SampleProduct>[]>(() => [
  { key: "name", label: "Nombre", sortable: true, value: (p) => p.name },
  {
    key: "baseUnit",
    label: "Unidad base",
    value: (p) => t(`units.${p.baseUnit}`),
  },
  {
    key: "stock",
    label: "Existencias",
    align: "end",
    sortable: true,
    sortAs: "decimal",
    value: (p) => String(p.stock),
  },
  {
    key: "unitCost",
    label: "Coste",
    align: "end",
    sortable: true,
    sortAs: "decimal",
    // Sorted per base unit: within one unit, the same order as per kilo or litre.
    value: (p) => p.unitCost,
  },
  { key: "status", label: "Estado", value: (p) => p.status },
]);
const tableRows = computed(() => {
  if (tableState.value === "empty") return [];
  const sorted = sortRows(
    sampleProducts,
    sort.value,
    columns.value,
    language.value,
  );
  return pageRows(sorted, page.value, PAGE_SIZE);
});
const tableTotal = computed(() =>
  tableState.value === "empty" ? 0 : sampleProducts.length,
);
const statusBadge = {
  active: { tone: "success", label: "Activo" },
  low: { tone: "warning", label: "Bajo mínimo" },
  inactive: { tone: "neutral", label: "Inactivo" },
} as const;

const swatches = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["surface-muted", "bg-surface-muted"],
  ["fg", "bg-fg"],
  ["fg-muted", "bg-fg-muted"],
  ["line", "bg-line"],
  ["line-strong", "bg-line-strong"],
  ["primary", "bg-primary"],
  ["primary-soft", "bg-primary-soft"],
  ["danger", "bg-danger"],
  ["danger-soft", "bg-danger-soft"],
  ["warning", "bg-warning"],
  ["warning-soft", "bg-warning-soft"],
  ["success", "bg-success"],
  ["success-soft", "bg-success-soft"],
  ["info", "bg-info"],
  ["info-soft", "bg-info-soft"],
  ["focus", "bg-focus"],
] as const;
</script>

<template>
  <div
    data-testid="component-gallery"
    class="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8 text-fg"
  >
    <header class="flex flex-col gap-4">
      <div>
        <h1 class="text-3xl font-bold">Galería de componentes</h1>
        <p class="mt-2 max-w-2xl text-fg-muted">
          Cada componente del sistema de diseño, en cada estado. Cambia el tema
          y el idioma para verlos en claro, en oscuro y en inglés.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <UiSelect
          v-model="theme"
          label="Tema"
          :options="[
            { value: 'system', label: 'Del sistema' },
            { value: 'light', label: 'Claro' },
            { value: 'dark', label: 'Oscuro' },
          ]"
        />
        <LanguageSwitch :signed-in="false" />
      </div>
    </header>

    <GallerySection
      title="Colores"
      description="Los tokens de color. Cada pareja que usan los componentes cumple WCAG 2.2 AA en claro y en oscuro (src/design/tokens.test.ts)."
    >
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <li
          v-for="[name, swatch] in swatches"
          :key="name"
          class="flex flex-col gap-1.5 text-sm"
        >
          <span :class="['h-12 rounded-md border border-line', swatch]" />
          <code>{{ name }}</code>
        </li>
      </ul>
    </GallerySection>

    <GallerySection
      title="Botones"
      description="Uno principal por página; secundario a su lado; fantasma en barras y tablas; peligro para lo que borra o deshace."
    >
      <div class="flex flex-wrap items-center gap-3">
        <UiButton @click="pressed += 1">Guardar</UiButton>
        <UiButton variant="secondary">Cancelar</UiButton>
        <UiButton variant="ghost">Ver detalles</UiButton>
        <UiButton variant="danger">Eliminar</UiButton>
        <UiButton :icon="Plus">Añadir producto</UiButton>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <UiButton size="sm">Pequeño</UiButton>
        <UiButton size="sm" variant="secondary">Pequeño secundario</UiButton>
        <UiButton disabled>No disponible</UiButton>
        <UiButton loading>Guardando</UiButton>
      </div>
      <p class="text-sm text-fg-muted" aria-live="polite">
        Pulsado {{ pressed }} veces
      </p>
    </GallerySection>

    <GallerySection title="Campos de texto">
      <div class="grid gap-6 sm:grid-cols-2">
        <UiTextField
          v-model="productName"
          label="Nombre del producto"
          hint="Como aparece en la carta."
        />
        <UiTextField
          v-model="email"
          label="Correo electrónico"
          type="email"
          autocomplete="email"
        />
        <UiTextField
          v-model="supplier"
          label="Proveedor"
          error="Escribe el nombre del proveedor."
        />
        <UiTextField v-model="notes" label="Notas" optional />
        <UiTextField v-model="code" label="Código interno" disabled />
      </div>
    </GallerySection>

    <GallerySection
      title="Campos numéricos"
      description="Guardan un decimal exacto, nunca un número de JavaScript. Aceptan coma o punto, y explican lo que no aceptan al salir del campo."
    >
      <div class="grid gap-6 sm:grid-cols-2">
        <div class="flex flex-col gap-2">
          <UiNumberField
            v-model="quantity"
            label="Cantidad"
            unit="kg"
            hint="Hasta 3 decimales."
          />
          <p class="text-sm text-fg-muted">
            Valor: <code>{{ quantity || "—" }}</code>
          </p>
        </div>
        <UiNumberField
          v-model="price"
          label="Precio unitario"
          unit="€"
          :max-decimals="6"
        />
        <UiNumberField
          v-model="adjustment"
          label="Ajuste de inventario"
          unit="kg"
          allow-negative
          hint="Negativo si falta género."
        />
        <UiNumberField
          v-model="price"
          label="Precio anterior"
          unit="€"
          disabled
        />
      </div>
    </GallerySection>

    <GallerySection title="Selección">
      <div class="grid gap-6 sm:grid-cols-2">
        <UiSelect
          v-model="baseUnit"
          label="Unidad base"
          :options="unitOptions"
        />
        <UiSelect
          v-model="storeroom"
          label="Almacén"
          :options="storeroomOptions"
          error="Elige un almacén."
        />
        <UiSelect
          label="Proveedor habitual"
          :options="unitOptions"
          optional
          disabled
        />
      </div>
    </GallerySection>

    <GallerySection
      title="Búsqueda en una lista"
      description="Para listas largas. Sin distinguir mayúsculas ni acentos: «limon» encuentra «Limón»."
    >
      <div class="grid gap-6 sm:grid-cols-2">
        <UiCombobox
          v-model="product"
          label="Producto"
          :options="productOptions"
        />
        <UiCombobox
          label="Producto sustituto"
          :options="productOptions"
          optional
          disabled
        />
      </div>
    </GallerySection>

    <GallerySection title="Casillas e interruptores">
      <div class="grid gap-6 sm:grid-cols-2">
        <div class="flex flex-col gap-4">
          <UiCheckbox
            v-model="active"
            label="Activo"
            hint="Los productos inactivos no salen en los recuentos."
          />
          <UiCheckbox v-model="soldByUnit" label="Se vende por unidades" />
          <UiCheckbox v-model="allStorerooms" label="Todos los almacenes" />
          <UiCheckbox label="Producto de temporada" disabled />
        </div>
        <div class="flex flex-col gap-4">
          <UiSwitch
            v-model="lowStockAlert"
            label="Avisar cuando falte stock"
            hint="Un aviso al bajar del mínimo."
          />
          <UiSwitch v-model="autoOrder" label="Pedido automático" />
          <UiSwitch label="Sincronizar con la caja" disabled />
        </div>
      </div>
    </GallerySection>

    <GallerySection title="Tarjetas">
      <UiCard
        title="Pedido a Frutas García"
        description="Entrega prevista el 21/10/2026"
      >
        <p>12 líneas, 3 pendientes de confirmar.</p>
        <template #footer>
          <UiButton variant="secondary" size="sm">Ver el pedido</UiButton>
          <UiButton size="sm" :icon="Truck">Recibir</UiButton>
        </template>
      </UiCard>
    </GallerySection>

    <GallerySection
      title="Diálogos"
      description="El foco entra en el diálogo y no sale; Escape lo cierra y el foco vuelve al botón que lo abrió."
    >
      <div>
        <UiDialog
          v-model:open="dialogOpen"
          title="¿Eliminar el producto?"
          description="Tomate dejará de salir en los recuentos y los pedidos. Su historial se conserva."
        >
          <template #trigger>
            <UiButton variant="danger">Eliminar producto</UiButton>
          </template>
          <template #footer="{ close }">
            <UiButton variant="secondary" @click="close">Cancelar</UiButton>
            <UiButton variant="danger" @click="confirmDelete">
              Eliminar
            </UiButton>
          </template>
        </UiDialog>
      </div>
    </GallerySection>

    <GallerySection
      title="Avisos"
      description="Un error se queda hasta que se cierra; los demás se van solos. F8 lleva el foco a los avisos."
    >
      <div class="flex flex-wrap gap-3">
        <UiButton
          variant="secondary"
          @click="
            showToast({
              tone: 'success',
              title: 'Pedido enviado',
              description: 'Frutas García lo recibirá por correo.',
            })
          "
        >
          Aviso de éxito
        </UiButton>
        <UiButton
          variant="secondary"
          @click="
            showToast({
              tone: 'error',
              title: 'No se ha podido guardar el pedido',
              description: 'Comprueba la conexión y vuelve a intentarlo.',
            })
          "
        >
          Aviso de error
        </UiButton>
        <UiButton
          variant="secondary"
          @click="
            showToast({
              tone: 'info',
              title: 'Hay una versión nueva de la app',
            })
          "
        >
          Aviso informativo
        </UiButton>
      </div>
    </GallerySection>

    <GallerySection title="Pestañas">
      <UiTabs v-model="tab" :tabs="tabs" label="Ficha del producto">
        <template #general>
          <p>Tomate pera, de Almería. Se cuenta en gramos.</p>
        </template>
        <template #units>
          <p>1 caja = 6 kg. 1 kg = 1000 g.</p>
        </template>
        <template #history>
          <p>Sin movimientos.</p>
        </template>
        <template #suppliers>
          <p>Frutas García, Hortalizas del Sur.</p>
        </template>
      </UiTabs>
    </GallerySection>

    <GallerySection
      title="Etiquetas"
      description="El texto dice el estado; el color solo lo repite."
    >
      <div class="flex flex-wrap gap-2">
        <UiBadge tone="success">Activo</UiBadge>
        <UiBadge tone="warning">Bajo mínimo</UiBadge>
        <UiBadge tone="danger">Rechazado</UiBadge>
        <UiBadge>Borrador</UiBadge>
        <UiBadge tone="info">Nuevo</UiBadge>
        <UiBadge tone="primary">Destacado</UiBadge>
      </div>
    </GallerySection>

    <GallerySection title="Estados">
      <div class="grid gap-4 lg:grid-cols-3">
        <UiCard title="Vacío" :heading-level="3">
          <UiEmptyState
            title="Todavía no hay proveedores"
            description="Añade el primero para hacerle pedidos."
          >
            <UiButton :icon="Plus" size="sm">Añadir proveedor</UiButton>
          </UiEmptyState>
        </UiCard>
        <UiCard title="Cargando" :heading-level="3">
          <UiLoadingState :lines="4" />
        </UiCard>
        <UiCard title="Con un error" :heading-level="3">
          <UiErrorState
            message="No se han podido cargar los proveedores."
            retryable
          />
        </UiCard>
      </div>
    </GallerySection>

    <GallerySection
      title="Tabla"
      description="Ordenable desde las cabeceras y por páginas. En el móvil se desplaza en horizontal."
    >
      <div class="sm:max-w-xs">
        <UiSelect
          v-model="tableState"
          label="Estado de la tabla"
          :options="tableStates"
        />
      </div>
      <UiDataTable
        v-model:sort="sort"
        v-model:page="page"
        caption="Productos"
        caption-visible
        :columns="columns"
        :rows="tableRows"
        :row-key="(p) => p.id"
        :total="tableTotal"
        :page-size="PAGE_SIZE"
        :loading="tableState === 'loading'"
        :error="
          tableState === 'error'
            ? 'No se han podido cargar los productos.'
            : undefined
        "
        empty-title="Todavía no hay productos"
        empty-description="Los productos aparecen aquí al darlos de alta."
      >
        <template #cell-stock="{ row }">
          {{ formatQuantity(row.stock, row.baseUnit, language) }}
        </template>
        <template #cell-unitCost="{ row }">
          {{ formatUnitCost(row.unitCost, row.baseUnit, language) }}
        </template>
        <template #cell-status="{ row }">
          <UiBadge :tone="statusBadge[row.status].tone">
            {{ statusBadge[row.status].label }}
          </UiBadge>
        </template>
        <template #empty>
          <UiButton :icon="Plus" size="sm">Añadir producto</UiButton>
        </template>
      </UiDataTable>
    </GallerySection>
  </div>
</template>
