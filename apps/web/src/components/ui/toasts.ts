import { readonly, ref } from "vue";

// Toasts (#85): short notices after an action, such as "Producto guardado". One queue for the
// app; <Toaster /> shows it.

export interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  description?: string;
}

const queue = ref<Toast[]>([]);
let nextId = 1;

/** Shows a notice. An error stays until it's closed; the others go after a few seconds. */
export function showToast(toast: Omit<Toast, "id">): void {
  queue.value.push({ ...toast, id: nextId++ });
}

/** Removes a notice, once it has closed. */
export function dismissToast(id: number): void {
  queue.value = queue.value.filter((toast) => toast.id !== id);
}

/** The notices showing now. */
export const toasts = readonly(queue);
