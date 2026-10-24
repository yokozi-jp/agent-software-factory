// Link checks inside docs/ that iwe stats does not do. Run by scripts/docs-check.sh from docs/.
//   1. A relative link's #fragment must match a heading of the target (GitHub's slug rules).
//      Links within the same file are left to markdownlint (MD051).
//   2. Guidelines imported from future-architect/arch-guidelines live in docs/; link to the docs/
//      document, not the site. Only an area's about.md (the source and license page) links to the site.
//      An area counts as imported when its about.md cites it; guidelines that were not imported keep site links.
// Prints one problem per line and exits 1 when there is any.
import fs from "node:fs";
import path from "node:path";

// Source directories of arch-guidelines imported into docs/, read from the frontmatter `sources` of each about.md.
const frontmatter = (text) =>
  text.startsWith("---\n") ? text.slice(4, text.indexOf("\n---", 4)) : "";
const IMPORTED = [
  ...new Set(
    fs
      .readdirSync(".", { recursive: true })
      .filter((f) => path.basename(f) === "about.md")
      .flatMap((f) =>
        [
          ...frontmatter(fs.readFileSync(f, "utf8")).matchAll(
            /arch-guidelines\/documents\/(for[A-Za-z]+)\//g,
          ),
        ].map((m) => m[1]),
      ),
  ),
];
const site = new RegExp(
  `https://future-architect\\.github\\.io/arch-guidelines/documents/(${IMPORTED.join("|") || "(?!)"})/`,
);

// GitHub heading anchors: lower case, drop punctuation, spaces to hyphens, -1, -2 ... for duplicates.
function slugs(text) {
  const seen = {};
  const out = new Set();
  let fence = null;
  for (const line of text.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!m) continue;
    const base = m[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
      .replace(/ /g, "-");
    const n = seen[base] ?? 0;
    seen[base] = n + 1;
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const cache = {};
const problems = [];
const files = fs
  .readdirSync(".", { recursive: true })
  .filter((f) => f.endsWith(".md") && !f.split(path.sep).includes("node_modules"));
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  // Frontmatter `sources` cites the site on purpose (the source of the document).
  const bodyStart = lines[0] === "---" ? lines.indexOf("---", 1) + 1 : 0;
  const isAbout = path.basename(file) === "about.md";
  let fence = null;
  lines.forEach((line, i) => {
    if (i < bodyStart) return;
    const f = line.replace(/^(>\s?)+/, "").match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    // Inline code is not a link.
    const text = line.replace(/`[^`]*`/g, "");
    for (const m of text.matchAll(/\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (!isAbout && site.test(target)) {
        problems.push(
          `${file}:${i + 1}: links to the arch-guidelines site for a guideline imported into docs/; link to the docs/ document`,
        );
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const hash = target.indexOf("#");
      if (hash < 0) continue;
      const rel = path.normalize(path.join(path.dirname(file), decodeURI(target.slice(0, hash))));
      if (rel.startsWith("..") || !rel.endsWith(".md") || !fs.existsSync(rel)) continue;
      let frag = target.slice(hash + 1);
      try {
        frag = decodeURIComponent(frag);
      } catch {}
      cache[rel] ??= slugs(fs.readFileSync(rel, "utf8"));
      if (!cache[rel].has(frag.toLowerCase()))
        problems.push(`${file}:${i + 1}: ${rel} has no heading for #${frag}`);
    }
  });
}
if (problems.length) {
  console.log(problems.join("\n"));
  process.exit(1);
}
