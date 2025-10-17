import axios from "axios";
import fs from "fs-extra";

const META_FILE = "./sync.json";

async function saveSync(productId, data) {
  let syncData = {};
  if (await fs.pathExists(META_FILE)) syncData = await fs.readJson(META_FILE);
  syncData[productId] = { ...syncData[productId], ...data };
  await fs.writeJson(META_FILE, syncData, { spaces: 2 });
}

export async function publishToMeta(product) {
  console.log(`[🚀] نشر على Meta: ${product.title}`);
  try {
    const caption = `${product.title}\n\n${product.description.replace(/<[^>]+>/g, "")}`;
    const image = product?.images?.[0]?.src;
    if (!image) {
      console.log(`[⚠️] لا توجد صور للمنتج: ${product.title}`);
      return;
    }

    // Instagram
    const igRes = await axios.post(
      `${process.env.META_GRAPH_URL}/${process.env.META_IG_BUSINESS_ID}/media`,
      {
        image_url: image,
        caption,
        access_token: process.env.META_ACCESS_TOKEN
      }
    );
    const igCreationId = igRes.data.id;

    await axios.post(
      `${process.env.META_GRAPH_URL}/${process.env.META_IG_BUSINESS_ID}/media_publish`,
      {
        creation_id: igCreationId,
        access_token: process.env.META_ACCESS_TOKEN
      }
    );
    console.log(`[✅] تم النشر على Instagram: ${product.title}`);

    let fbPostId = null;
    if (process.env.SYNC_TO_FACEBOOK === "true") {
      const fbRes = await axios.post(
        `${process.env.META_GRAPH_URL}/${process.env.META_PAGE_ID}/photos`,
        {
          url: image,
          caption,
          access_token: process.env.META_ACCESS_TOKEN
        }
      );
      fbPostId = fbRes.data.id;
      console.log(`[✅] تم النشر على Facebook Page: ${product.title}`);
    }

    await saveSync(product.id, {
      ig_post_id: igCreationId,
      fb_post_id: fbPostId,
      status: "active",
      last_sync: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[❌] فشل النشر: ${product.title} - ${err.message}`);
  }
}

export async function deleteFromMeta(productId) {
  if (!(await fs.pathExists(META_FILE))) return;
  const syncData = await fs.readJson(META_FILE);
  const data = syncData[productId];
  if (!data) return;

  console.log(`[🗑️] حذف منشورات المنتج: ${productId}`);
  try {
    if (data.ig_post_id)
      await axios.delete(`${process.env.META_GRAPH_URL}/${data.ig_post_id}?access_token=${process.env.META_ACCESS_TOKEN}`);
    if (data.fb_post_id)
      await axios.delete(`${process.env.META_GRAPH_URL}/${data.fb_post_id}?access_token=${process.env.META_ACCESS_TOKEN}`);
    delete syncData[productId];
    await fs.writeJson(META_FILE, syncData, { spaces: 2 });
  } catch (err) {
    console.error(`[❌] فشل حذف منشورات Meta: ${err.message}`);
  }
}
