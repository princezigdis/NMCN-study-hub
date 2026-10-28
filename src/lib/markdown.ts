import { marked } from "marked";
import DOMPurify from "dompurify";
import { supabase } from "./supabase";

marked.setOptions({ gfm: true, breaks: false });

/** Render Markdown to sanitised HTML (no scripts, no inline handlers, safe links). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md ?? "", { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
    FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
    FORBID_ATTR: ["style"],
  });
}

/** Open external links in a new tab safely. */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
});

/**
 * Note images live in a private bucket and are written in Markdown as
 * ![alt](/__storage/<bucket>/<path>). Swap them for short-lived signed URLs.
 */
export async function resolveStorageImages(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img[src^="/__storage/"]'));
  await Promise.all(imgs.map(async (img) => {
    const rest = img.getAttribute("src")!.slice("/__storage/".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return;
    const bucket = rest.slice(0, slash);
    if (!["content", "question-images"].includes(bucket)) return;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(decodeURIComponent(rest.slice(slash + 1)), 3600);
    if (data?.signedUrl) img.src = data.signedUrl;
    img.loading = "lazy";
  }));
}
