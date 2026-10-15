<script setup lang="ts">
import { MeResponse, type Product, ProductList } from "@kitchen-ops/shared";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiGet } from "../api";
import { authClient, type Me } from "../auth";

const router = useRouter();
const me = ref<Me>();
const products = ref<Product[]>([]);
const error = ref("");
const loading = ref(true);

const unitLabel: Record<Product["baseUnit"], string> = {
  g: "grams",
  ml: "millilitres",
  unit: "units",
};

onMounted(async () => {
  try {
    const [user, list] = await Promise.all([
      apiGet("/api/me", MeResponse),
      apiGet("/api/products", ProductList),
    ]);
    me.value = user;
    products.value = list.products;
  } catch {
    error.value = "Could not load products. Check your connection and reload.";
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
  <div class="toolbar">
    <span v-if="me">{{ me.name }} · {{ me.role }}</span>
    <button type="button" class="secondary" @click="signOut">Sign out</button>
  </div>

  <h1>Products</h1>
  <p v-if="loading">Loading…</p>
  <p v-else-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="products.length === 0">No products yet.</p>
  <ul v-else class="list">
    <li v-for="product in products" :key="product.id">
      <span>{{ product.name }}</span>
      <span class="muted">{{ unitLabel[product.baseUnit] }}</span>
    </li>
  </ul>
</template>
