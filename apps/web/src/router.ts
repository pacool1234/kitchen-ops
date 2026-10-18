import { createRouter, createWebHistory } from "vue-router";
import { whoAmI } from "./auth";
import { adoptUserLocale } from "./i18n";
import LoginView from "./views/LoginView.vue";
import ProductsView from "./views/ProductsView.vue";
import TwoFactorSetupView from "./views/TwoFactorSetupView.vue";

declare module "vue-router" {
  interface RouteMeta {
    /** Reachable without signing in. Every other page needs a session. */
    public?: boolean;
    /** Sets its own width, instead of the narrow column. */
    wide?: boolean;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/products" },
    { path: "/login", component: LoginView, meta: { public: true } },
    {
      path: "/setup-2fa",
      component: TwoFactorSetupView,
      meta: { public: true },
    },
    { path: "/products", component: ProductsView },
    // Development and browser-test builds only: production builds drop the route and its code.
    ...(__GALLERY__
      ? [
          {
            path: "/gallery",
            component: () => import("./gallery/GalleryView.vue"),
            meta: { public: true, wide: true },
          },
        ]
      : []),
  ],
});

// The API decides who is signed in; the web app only follows its answer.
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const me = await whoAmI();
  if (me === "signed-out") return { path: "/login" };
  if (me === "two-factor-required") return { path: "/setup-2fa" };
  await adoptUserLocale(me);
  return true;
});
