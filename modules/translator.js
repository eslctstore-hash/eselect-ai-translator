import axios from "axios";

export async function translateProduct(product) {
  try {
    const prompt = `
أعد صياغة هذا النص باحترافية بالعربية بأسلوب تسويقي غني ومنسق HTML:
العنوان: ${product.title}
الوصف: ${product.body_html || product.description || ""}
    `;
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );
    const translation = res.data.choices[0].message.content.trim();
    return { title: product.title, description: translation };
  } catch (err) {
    console.error("[❌] خطأ في الترجمة:", err.message);
    return { title: product.title, description: product.body_html || "" };
  }
}
