<script setup lang="ts">
import { endpoints, type Product } from "@kitchen-ops/shared";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError, call } from "../api";
import { authClient, type Me } from "../auth";
import LanguageSwitch from "../components/LanguageSwitch.vue";
import { type MessageKey, useT } from "../i18n";
import { errorMessageKey } from "../i18n/errors";

const t = useT();
const router = useRouter();
const me = ref<Me>();
const products = ref<Product[]>([]);
const error = ref<MessageKey>();
const loading = ref(true);

onMounted(async () => {
  try {
    const [user, list] = await Promise.all([
      call(endpoints.me),
      call(endpoints.listProducts),
    ]);
    me.value = user;
    products.value = list.products;
  } catch (caught) {
    // The API's answer if it gave one, else most likely the connection.
    error.value =
      caught instanceof ApiError
        ? errorMessageKey(caught)
        : "products.loadFailed";
  } finally {
    loading.value = false;
  }
});

async function signOut() {
  await authClient.signOut();
  await router.push("/login");
}
</script>

<template>
  <div class="legacy">
    <div class="toolbar">
      <span v-if="me">{{ me.name }} · {{ t(`roles.${me.role}`) }}</span>
      <LanguageSwitch :signed-in="true" />
      <button type="button" class="secondary" @click="signOut">
        {{ t("products.signOut") }}
      </button>
    </div>

    <h1>{{ t("products.title") }}</h1>
    <p v-if="loading">{{ t("products.loading") }}</p>
    <p v-else-if="error" class="error" role="alert">{{ t(error) }}</p>
    <p v-else-if="products.length === 0">{{ t("products.empty") }}</p>
    <ul v-else class="list">
      <li v-for="product in products" :key="product.id">
        <span>{{ product.name }}</span>
        <span class="muted">{{ t(`units.${product.baseUnit}`) }}</span>
      </li>
    </ul>
  </div>
</template>
