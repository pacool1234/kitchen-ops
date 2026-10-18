import { fieldErrors, type FieldErrorCode } from "@kitchen-ops/shared";
import { computed, reactive, ref, toRaw, watch } from "vue";
import type { z } from "zod";
import { ApiError } from "../api";

// A catalogue form (#89, decision 0027): its values, checked by the same schema the API checks
// them with (packages/shared), and the API's own refusals shown on the same fields. A field's
// error shows once it has been left, or after a try to save; never while it's first typed.

export type FieldErrors = Record<string, FieldErrorCode>;

/** The schema's output if the values pass, and each refused field's code either way. */
export function checkFields<S extends z.ZodType>(
  schema: S,
  values: unknown,
): { data?: z.output<S>; errors: FieldErrors } {
  const result = schema.safeParse(values);
  return result.success
    ? { data: result.data, errors: {} }
    : { errors: fieldErrors(result.error.issues, values) };
}

/** The same JSON whatever the order of an object's keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether the form's values differ from the ones it was loaded with. */
export function isDirty(values: unknown, loaded: unknown): boolean {
  return canonical(values) !== canonical(loaded);
}

/** The fields the API refused, if that's what the error is. */
export function apiFieldErrors(error: unknown): FieldErrors | undefined {
  return error instanceof ApiError && error.fields
    ? { ...error.fields }
    : undefined;
}

/**
 * A form's state: `values` to bind to its fields, `error(field)` to show by each, `dirty`, and
 * `submit` to check everything and then save. A save the API refuses shows its field errors.
 */
export function useForm<S extends z.ZodType, V extends Record<string, unknown>>(
  schema: S,
  initial: V,
) {
  const values = reactive({ ...initial }) as V;
  const loaded = ref<V>({ ...initial });
  const touched = reactive(new Set<string>());
  const submitted = ref(false);
  const saving = ref(false);
  /** What the API refused, until that field changes. */
  const refused = ref<FieldErrors>({});

  const checked = computed(() => checkFields(schema, values).errors);
  const dirty = computed(() => isDirty(toRaw(values), loaded.value));

  for (const field of Object.keys(initial)) {
    watch(
      () => values[field],
      () => {
        if (field in refused.value) {
          refused.value = Object.fromEntries(
            Object.entries(refused.value).filter(([name]) => name !== field),
          );
        }
      },
    );
  }

  /** The code to show by a field, if any. */
  function error(field: string): FieldErrorCode | undefined {
    const shown = submitted.value || touched.has(field);
    return refused.value[field] ?? (shown ? checked.value[field] : undefined);
  }

  /** A field was left: its error may show now. */
  function touch(field: string) {
    touched.add(field);
  }

  /** The values become the ones loaded: after a save, or a new item to edit. */
  function reset(next: V) {
    Object.assign(values, next);
    loaded.value = { ...next };
    touched.clear();
    submitted.value = false;
    refused.value = {};
  }

  /**
   * Checks every field; if they pass, saves with `save`. Returns whether it saved. The API's
   * field errors show by their fields; any other error is the caller's.
   */
  async function submit(
    save: (data: z.output<S>) => Promise<void>,
  ): Promise<boolean> {
    submitted.value = true;
    const { data } = checkFields(schema, values);
    if (data === undefined) return false;
    saving.value = true;
    try {
      await save(data);
      return true;
    } catch (caught) {
      const fields = apiFieldErrors(caught);
      if (!fields) throw caught;
      refused.value = fields;
      return false;
    } finally {
      saving.value = false;
    }
  }

  return { values, dirty, saving, error, touch, reset, submit };
}
