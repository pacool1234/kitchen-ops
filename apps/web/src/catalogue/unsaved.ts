import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

// Unsaved changes are warned about (#89): leaving a changed form inside the app asks first, in
// a dialog; closing or reloading the tab gets the browser's own warning, the only one it allows.

/** `asking` opens the dialog; its buttons call `stay` or `leave`. */
export function useUnsavedGuard(dirty: Ref<boolean>) {
  const asking = ref(false);
  let answer: ((leave: boolean) => void) | undefined;

  function decide(leave: boolean) {
    asking.value = false;
    answer?.(leave);
    answer = undefined;
  }

  onBeforeRouteLeave(() => {
    if (!dirty.value) return true;
    asking.value = true;
    return new Promise<boolean>((resolve) => {
      answer = resolve;
    });
  });
  // Closed with Escape or its close button: staying, the safe answer.
  watch(asking, (open) => {
    if (!open && answer) decide(false);
  });

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value) event.preventDefault();
  }
  onMounted(() => window.addEventListener("beforeunload", onBeforeUnload));
  onUnmounted(() => window.removeEventListener("beforeunload", onBeforeUnload));

  return { asking, stay: () => decide(false), leave: () => decide(true) };
}
