import { endpoints, mayCall, type Role } from "@kitchen-ops/shared";
import { nextTick, type Component } from "vue";
import {
  createRouter,
  createWebHistory,
  START_LOCATION,
  type RouteRecordRaw,
} from "vue-router";
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
    /** Who may open the page; anyone signed in if left out. Others go to its parent. */
    mayEnter?: (role: Role) => boolean;
  }
}

/**
 * A catalogue section's routes: its list (`/catalogue/suppliers`), a new item's form
 * (`…/new`, for the roles that may create one) and an item's page (`…/:id`).
 */
function itemRoutes(
  path: string,
  item: string,
  pages: {
    list: () => Promise<Component>;
    item: () => Promise<Component>;
    title: MessageKey;
    itemTitle: MessageKey;
    newTitle: MessageKey;
    mayCreate: (role: Role) => boolean;
  },
): RouteRecordRaw[] {
  return [
    {
      path,
      name: path,
      component: pages.list,
      meta: { title: pages.title, parent: "catalogue" },
    },
    {
      path: `${path}/new`,
      name: `new-${item}`,
      component: pages.item,
      meta: { title: pages.newTitle, parent: path, mayEnter: pages.mayCreate },
    },
    {
      path: `${path}/:id`,
      name: item,
      component: pages.item,
      props: true,
      // Until it has loaded; then the page is titled with the item's name.
      meta: { title: pages.itemTitle, parent: path },
    },
  ];
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
        // Supplier documents (#106): the list, the upload page and each document's page. Nested,
        // so the navigation's "Documentos" stays marked on all three.
        {
          path: "documents",
          children: [
            {
              path: "",
              name: "documents",
              component: () => import("./documents/DocumentsView.vue"),
              meta: { title: "documents.title", parent: "home" },
            },
            {
              path: "new",
              name: "new-document",
              component: () => import("./documents/UploadView.vue"),
              meta: { title: "documents.upload", parent: "documents" },
            },
            {
              path: ":id",
              name: "document",
              component: () => import("./documents/DocumentView.vue"),
              props: true,
              // Until it has been read; then it's titled with its type and number.
              meta: { title: "documents.item", parent: "documents" },
            },
          ],
        },
        // Stock per storeroom (#150): the list, and a product's stock and movements.
        {
          path: "stock",
          children: [
            {
              path: "",
              name: "stock",
              component: () => import("./stock/StockView.vue"),
              meta: { title: "stock.title", parent: "home" },
            },
            {
              path: ":id",
              name: "stock-product",
              component: () => import("./stock/StockProductView.vue"),
              props: true,
              // Until it has loaded; then the page is titled with the product's name.
              meta: { title: "stock.item", parent: "stock" },
            },
          ],
        },
        // The catalogue (#89): its sections' lists, and a page for each item.
        {
          path: "catalogue",
          name: "catalogue",
          redirect: { name: "products" },
          meta: { title: "catalogue.title", parent: "home" },
          children: [
            ...itemRoutes("products", "product", {
              list: () => import("./catalogue/ProductsView.vue"),
              item: () => import("./catalogue/ProductView.vue"),
              title: "products.title",
              itemTitle: "products.item",
              newTitle: "products.new",
              mayCreate: (role) => mayCall(endpoints.createProduct, role),
            }),
            ...itemRoutes("suppliers", "supplier", {
              list: () => import("./catalogue/SuppliersView.vue"),
              item: () => import("./catalogue/SupplierView.vue"),
              title: "suppliers.title",
              itemTitle: "suppliers.item",
              newTitle: "suppliers.new",
              mayCreate: (role) => mayCall(endpoints.createSupplier, role),
            }),
            ...itemRoutes("storerooms", "storeroom", {
              list: () => import("./catalogue/StoreroomsView.vue"),
              item: () => import("./catalogue/StoreroomView.vue"),
              title: "storerooms.title",
              itemTitle: "storerooms.item",
              newTitle: "storerooms.new",
              mayCreate: (role) => mayCall(endpoints.createStoreroom, role),
            }),
          ],
        },
        // The product list's address before the catalogue.
        { path: "products", redirect: { name: "products" } },
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
  // A page the role can't use (a new supplier's form, for counter staff): its parent instead.
  if (to.meta.mayEnter && !to.meta.mayEnter(me.role)) {
    return to.meta.parent ? { name: to.meta.parent } : { name: "home" };
  }
  return true;
});

// After moving to another page, focus goes to its title, so a screen reader says where the
// user is, and the next Tab starts from the top of the page. Not on the first page load, and
// not when only the #hash changed: that's the same page, as when the skip link moves focus to
// the content.
router.afterEach(async (to, from, failure) => {
  if (failure || from === START_LOCATION || to.path === from.path) return;
  await nextTick();
  document.querySelector<HTMLElement>("[data-page-title]")?.focus();
});
