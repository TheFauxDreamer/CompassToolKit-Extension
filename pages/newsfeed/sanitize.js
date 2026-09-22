// Allow-list sanitiser for newsfeed HTML (Compass uses a Quill editor).
// Produces a DocumentFragment safe to drop into the projector page.

const ALLOWED = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "SPAN", "DIV", "BLOCKQUOTE",
  "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "A", "IMG", "HR",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "SUB", "SUP", "FIGURE", "FIGCAPTION", "PRE", "CODE"
]);
const DROP_WITH_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "LINK", "META", "VIDEO", "AUDIO", "SVG", "MATH"]);

export function sanitizeHtml(html, { resolveUrl = (u) => u } = {}) {
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  const out = document.createDocumentFragment();
  for (const child of [...root.childNodes]) {
    const clean = cleanNode(child, resolveUrl);
    if (clean) out.appendChild(clean);
  }
  collapseEmptyParagraphs(out);
  return out;
}

function cleanNode(node, resolveUrl) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName;
  if (DROP_WITH_CONTENT.has(tag)) return null;

  if (!ALLOWED.has(tag)) {
    // Unwrap unknown elements but keep their text.
    const frag = document.createDocumentFragment();
    for (const c of [...node.childNodes]) {
      const cc = cleanNode(c, resolveUrl);
      if (cc) frag.appendChild(cc);
    }
    return frag;
  }

  const el = document.createElement(tag);
  if (tag === "IMG") {
    const src = node.getAttribute("src");
    if (!src || /^javascript:/i.test(src)) return null;
    el.dataset.src = resolveUrl(src); // loaded later with the Compass session
    el.alt = node.getAttribute("alt") || "";
    return el;
  }
  if (tag === "A") {
    // Links can't be clicked on a projector; keep the text, drop the target.
    el.className = "link";
  }
  if (tag === "TD" || tag === "TH") {
    for (const a of ["colspan", "rowspan"]) {
      const v = node.getAttribute(a);
      if (v && /^\d+$/.test(v)) el.setAttribute(a, v);
    }
  }
  // Keep Quill alignment/indent classes only.
  const cls = (node.getAttribute("class") || "").split(/\s+/).filter((c) => /^ql-(align|indent|size)-/.test(c));
  if (cls.length) el.className = [el.className, ...cls].filter(Boolean).join(" ");

  for (const c of [...node.childNodes]) {
    const cc = cleanNode(c, resolveUrl);
    if (cc) el.appendChild(cc);
  }
  return el;
}

// Quill writes blank lines as <p><br></p>. On a projector, runs of them waste space.
function collapseEmptyParagraphs(frag) {
  const isEmpty = (n) => n.nodeType === 1 && n.tagName === "P" && !n.textContent.trim() && !n.querySelector("img");
  let prevEmpty = true; // also trims leading blanks
  for (const n of [...frag.childNodes]) {
    if (isEmpty(n)) {
      if (prevEmpty) n.remove();
      else n.classList.add("gap");
      prevEmpty = true;
    } else if (n.nodeType === 3 && !n.textContent.trim()) {
      n.remove();
    } else {
      prevEmpty = false;
    }
  }
  // Trim trailing blanks
  let last = frag.lastChild;
  while (last && isEmpty(last)) { const p = last.previousSibling; last.remove(); last = p; }
}

export function plainText(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}
