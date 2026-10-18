import { ROLES, type Role } from "@kitchen-ops/shared";
import { House, Package } from "lucide-vue-next";
import type { Component } from "vue";
import type { MessageKey } from "../i18n";

// The app's places (#85): one list for the sidebar, the bottom bar and the home page's
// shortcuts. Each says which roles may see it (spec section 6); the API still checks every
// call, so this only keeps people from seeing what they can't use.

export interface NavItem {
  /** The route's name. */
  name: string;
  label: MessageKey;
  /** One line on the home page's shortcut. */
  description?: MessageKey;
  icon: Component;
  roles: readonly Role[];
}

export const NAV: NavItem[] = [
  { name: "home", label: "home.title", icon: House, roles: ROLES },
  {
    name: "products",
    label: "products.title",
    description: "products.description",
    icon: Package,
    roles: ROLES,
  },
];

/** The places `role` may go, in the list's order. */
export function visibleNav<T extends Pick<NavItem, "roles">>(
  items: readonly T[],
  role: Role,
): T[] {
  return items.filter((item) => item.roles.includes(role));
}
