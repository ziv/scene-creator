/**
 * Attribution for recorded frames. The map's canvas holds only the imagery;
 * Google draws its logo and copyright in DOM. Both are composited onto every
 * frame here, with the provider text read live from the map's disclosure.
 */

const SECTION_TAG = 'GMP-INTERNAL-DISCLOSURE-SECTION';
const IGNORED = new Set(['map data', 'google maps terms', 'google maps', 'keyboard shortcuts']);
const MAP_DATA_LABEL = /^map data$/i;
const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'TEMPLATE']);

/** Leaf-text filter: drops labels, blanks and duplicates; keeps provider strings in order. Pure. */
export function parseProviderTexts(texts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t || IGNORED.has(t.toLowerCase()) || t.includes('{')) continue; // '{' guards against inlined CSS
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join(', ');
}

/** Elements under `root`, descending into open shadow roots. */
function* walk(root: ParentNode): Generator<Element> {
  for (const el of root.querySelectorAll('*')) {
    yield el;
    if (el.shadowRoot) yield* walk(el.shadowRoot);
  }
}

function leafTexts(root: ParentNode): string[] {
  const texts: string[] = [];
  for (const el of walk(root)) {
    if (SKIP_TAGS.has(el.tagName) || el.childElementCount > 0) continue;
    texts.push(el.textContent ?? '');
  }
  return texts;
}

/** Picks the section texts to use: the "Map data" section if there is one, otherwise all. Pure. */
export function selectProviderSection(sections: string[][]): string[] {
  const mapData = sections.find((texts) => texts.some((t) => MAP_DATA_LABEL.test(t.trim())));
  return mapData ?? sections.flat();
}

/** Reads the current provider attribution from the map's DOM. Null if the disclosure is not found. */
export function readAttribution(root: ShadowRoot): { providers: string } | null {
  const sections: Element[] = [];
  for (const el of walk(root)) if (el.tagName === SECTION_TAG) sections.push(el);
  if (sections.length === 0) return null;
  const texts = selectProviderSection(sections.map((s) => leafTexts(s.shadowRoot ?? s)));
  return { providers: parseProviderTexts(texts) };
}

/** The line drawn in the frame. */
export function attributionLine(providers: string, year: number): string {
  const base = `Map data ©${year} Google`;
  return providers ? `${base} · ${providers}` : base;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/** Draws the attribution bar along the bottom edge. */
export function drawAttribution(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  logo: HTMLImageElement | null,
  line: string,
  barHeight: number,
): void {
  const bar = Math.max(12, Math.round(height * barHeight));
  const top = height - bar;
  const pad = bar * 0.2;

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, top, width, bar);

  let textLeft = pad;
  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const h = bar - 2 * pad;
    const w = (logo.naturalWidth / logo.naturalHeight) * h;
    ctx.drawImage(logo, pad, top + pad, w, h);
    textLeft = pad + w + pad * 2;
  }

  ctx.font = `${Math.round(bar * 0.55)}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  const text = truncate(ctx, line, width - pad - textLeft);
  ctx.fillText(text, width - pad, top + bar / 2);
  ctx.restore();
}
