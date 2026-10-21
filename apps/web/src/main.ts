import { createApp } from "vue";
import App from "./App.vue";
import { i18n, showLocale } from "./i18n";
import { router } from "./router";
import { initSentry } from "./sentry";
import { registerAppUpdates } from "./shell/app-update";
import "./design/index.css";

const app = createApp(App);
initSentry(app); // before mounting, so errors while rendering are caught too
showLocale(i18n.global.locale.value); // <html lang> follows this device's last language
registerAppUpdates(router); // a new version deployed while this tab is open (#139)
app.use(i18n).use(router).mount("#app");
