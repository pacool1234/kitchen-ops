import { nextTick } from "vue";
import { createRouter, createWebHistory, START_LOCATION } from "vue-router";
import { whoAmI } from "./auth";
import { adoptUserLocale, type MessageKey } from "./i18n";
import { setCurrentUser } from "./session";
import AppShell from "./shell/AppShell.vue";
import AuthLayout from "./shell/AuthLayout.vue";
import LoginView from "./views/LoginView.vue";

declare module "vue-router" {
  interface RouteMeta {
    /** Reachable without signing in. Every other page needs a session. */
    public?: boolean;
    /** The page's title: its h1, the browser tab's title, and its place in breadcrumbs. */
    title?: MessageKey;
    /** The route above this page in the breadcrumb, by name. */
    parent?: string;
  }
}

// Each page's code loads when it's first visited, so the first load carries only the frame and
// the sign-in page. The 2FA setup, with its QR code library, loads only for owners setting up.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Before sign-in: one card, in AuthLayout.
    {
      path: "/login",
      component: AuthLayout,
      meta: { public: true },
      children: [
        {
          path: "",
          name: "login",
          component: LoginView,
          meta: { title: "signIn.title" },
        },
      ],
    },
    {
      path: "/setup-2fa",
      component: AuthLayout,
      meta: { public: true },
      children: [
        {
          path: "",
          name: "setup-2fa",
          component: () => import("./views/TwoFactorSetupView.vue"),
          meta: { title: "twoFactor.title" },
        },
      ],
    },
    // Signed in: the app's frame, with its navigation (src/shell).
    {
      path: "/",
      component: AppShell,
      children: [
        {
          path: "",
          name: "home",
          component: () => import("./views/HomeView.vue"),
          meta: { title: "home.title" },
        },
        {
          path: "products",
          name: "products",
          component: () => import("./views/ProductsView.vue"),
          meta: { title: "products.title", parent: "home" },
        },
      ],
    },
    // Development and browser-test builds only: production builds drop the route and its code.
    ...(__GALLERY__
      ? [
          {
            path: "/gallery",
            component: () => import("./gallery/GalleryView.vue"),
            meta: { public: true },
          },
        ]
      : []),
    { path: "/:unknown(.*)*", redirect: "/" },
  ],
});

// The API decides who is signed in; the web app only follows its answer.
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const me = await whoAmI();
  if (me === "signed-out") {
    setCurrentUser(null);
    return { name: "login" };
  }
  if (me === "two-factor-required") return { name: "setup-2fa" };
  setCurrentUser(me);
  await adoptUserLocale(me);
  return true;
});

// After moving to another page, focus goes to its title, so a screen reader says where the
// user is, and the next Tab starts from the top of the page. Not on the first page load.
router.afterEach(async (_to, from, failure) => {
  if (failure || from === START_LOCATION) return;
  await nextTick();
  document.querySelector<HTMLElement>("[data-page-title]")?.focus();
});
