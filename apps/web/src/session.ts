import { readonly, ref } from "vue";
import type { Me } from "./auth";

// Who is signed in, for the app's frame (#85). The router's guard asks the API on every
// navigation (router.ts) and keeps the answer here; the API stays the judge.

const user = ref<Me | null>(null);

/** The signed-in user, or null on the sign-in pages. */
export const currentUser = readonly(user);

export function setCurrentUser(me: Me | null): void {
  user.value = me;
}
