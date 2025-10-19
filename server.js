// =============== SHOPIFY API HELPER ===============
async function updateShopifyProduct(productId, payload) {
  const restUrl = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}.json`;
  try {
    await axios.put(
      restUrl,
      { product: payload },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("SHOPIFY_UPDATE", `Product ${productId} updated successfully (REST).`);
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("SHOPIFY_ERROR", `❌ API call to update product failed: ${errorMessage}`, "❌");

    // إذا كانت المشكلة بسبب تعدد الـ variants → استخدم GraphQL
    if (errorMessage.includes("cannot be used to update products with more than 100 variants")) {
      log("GRAPHQL_FALLBACK", `⚙️ Switching to GraphQL update for product ${productId}...`, "⚙️");

      const mutation = `
        mutation productUpdate($input: ProductInput!) {
          productUpdate(input: $input) {
            product { id title }
            userErrors { field message }
          }
        }`;

      const variables = {
        input: {
          id: `gid://shopify/Product/${productId}`,
          title: payload.title,
          descriptionHtml: payload.body_html,
          tags: payload.tags,
          metafields: payload.metafields,
          metafieldsGlobalTitleTag: payload.metafields_global_title_tag,
          metafieldsGlobalDescriptionTag: payload.metafields_global_description_tag
        },
      };

      try {
        const gqlResponse = await axios.post(
          `${SHOPIFY_STORE_URL}/admin/api/2024-07/graphql.json`,
          { query: mutation, variables },
          {
            headers: {
              "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
              "Content-Type": "application/json",
            },
          }
        );

        const { data } = gqlResponse;
        if (data.errors) {
          log("GRAPHQL_ERROR", JSON.stringify(data.errors), "❌");
          throw new Error("GraphQL API call failed");
        }

        if (data.data.productUpdate.userErrors?.length) {
          log("GRAPHQL_USER_ERRORS", JSON.stringify(data.data.productUpdate.userErrors), "⚠️");
        } else {
          log("SHOPIFY_UPDATE", `Product ${productId} updated successfully (GraphQL).`);
        }
      } catch (gqlErr) {
        const gqlMsg = gqlErr.response ? JSON.stringify(gqlErr.response.data) : gqlErr.message;
        log("GRAPHQL_ERROR", `❌ GraphQL update failed: ${gqlMsg}`, "❌");
      }

    } else if (errorMessage.includes("already exists")) {
      log("VARIANT_ERROR", `Continuing after duplicate variant error on product ${productId}.`, "⚠️");
    } else {
      throw new Error(`Shopify API call failed`);
    }
  }
}
