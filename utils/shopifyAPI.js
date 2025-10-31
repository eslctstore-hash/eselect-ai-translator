import axios from "axios";

const SHOPIFY_URL = `${process.env.SHOPIFY_STORE_URL}/admin/api/2025-10/products`;

export async function updateProductTags(productId, tags) {
  const payload = { product: { id: productId, tags: tags.join(", ") } };

  try {
    await axios.put(`${SHOPIFY_URL}/${productId}.json`, payload, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    });
    console.log(`🟢 Tags updated in Shopify for product ${productId}`);
  } catch (err) {
    console.error("❌ Shopify Tag Update Error:", err.response?.data || err.message);
  }
}
