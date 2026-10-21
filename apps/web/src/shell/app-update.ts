import { registerSW } from "virtual:pwa-register";
import { ref } from "vue";
import { START_LOCATION, type Router } from "vue-router";
import {
  appliesOnNavigation,
  isMissingChunk,
  reloadOnce,
  startUpdateChecks,
  type PageVisibility,
} from "./update-policy";

// A new version of the app, deployed while a tab is open (#139, decision 0042). The service
// worker installs it and leaves it waiting; the tab says so, takes it when asked or on moving
// to another page, and loads again a page whose code the server no longer has.

/** A new version is installed, waiting for this tab to take it. */
export const updateWaiting = ref(false);
/** The notice was closed: it shows again at the next check while the version still waits. */
export const noticeClosed = ref(false);

/** Tells the waiting service worker to take over; set once it's registered. */
let takeOver: (() => Promise<void>) | undefined;
/** Where to go once it has: the page asked for, or this one. */
let destination: string | undefined;
/** If it hasn't taken over by then, go anyway. */
const TAKE_OVER_WITHIN_MS = 3000;

/** Takes the waiting version, and opens `href` in it: this page unless told otherwise. */
export function applyUpdate(href = window.location.href): void {
  destination = href;
  void takeOver?.();
  setTimeout(() => window.location.assign(href), TAKE_OVER_WITHIN_MS);
}

const documentVisibility: PageVisibility = {
  visible: () => document.visibilityState === "visible",
  onChange(listener) {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/** sessionStorage, or nothing where it's blocked: then a missing page isn't loaded again. */
function sessionStore(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.sessionStorage;
  } catch {
    return {
      getItem: () => {
        throw new Error("no session storage");
      },
      setItem: () => {
        throw new Error("no session storage");
      },
    };
  }
}

/** Registers the service worker, and the router's part: once, before the app mounts. */
export function registerAppUpdates(router: Router): void {
  takeOver = registerSW({
    onNeedRefresh() {
      updateWaiting.value = true;
      noticeClosed.value = false;
    },
    // The new version has taken over this tab.
    onNeedReload() {
      window.location.assign(destination ?? window.location.href);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      startUpdateChecks(() => {
        noticeClosed.value = false;
        void registration.update();
      }, documentVisibility);
    },
  });

  router.beforeEach((to, from) => {
    const firstPage = from === START_LOCATION;
    if (!appliesOnNavigation({ waiting: updateWaiting.value, firstPage })) {
      return true;
    }
    applyUpdate(router.resolve(to).href);
    return false;
  });

  router.onError((error, to) => {
    if (!isMissingChunk(error)) return;
    if (reloadOnce(to.fullPath, sessionStore(), Date.now())) {
      window.location.assign(router.resolve(to).href);
    }
  });
}
