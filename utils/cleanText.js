export function cleanText(text = "") {
  return text
    .replace(/<\/?[^>]+(>|$)/g, "")
    .replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
