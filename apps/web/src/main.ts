import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initSentry } from "./sentry";
import "./style.css";

const app = createApp(App);
initSentry(app); // before mounting, so errors while rendering are caught too
app.use(router).mount("#app");
