import axios from "axios";

export async function getProductById(id) {
  const url = `${process.env.SHOPIFY_STORE_URL}/admin/api/2024-10/products/${id}.json`;
  const res = await axios.get(url, {
    headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN }
  });
  return res.data.product;
}
