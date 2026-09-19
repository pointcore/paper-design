/**
 * CDR -> SVG parser (ported from local cdr2svg reference implementation).
 * Supports ZIP CDR (content/root.dat + dataFileList.dat, incl. legacy riffData.cdr)
 * and 16-bit CDRX/CMX (RIFF CDRX containers).
 * Coordinates in CDR units (10000 per mm); output SVG per page with warnings.
 * Format research: https://github.com/LibreOffice/libcdr
 */
// @ts-nocheck

export interface CdrPageStats {
  objects?: number;
  shapes?: number;
  texts?: number;
  images?: number;
  skipped?: number;
  outside?: number;
}
export interface CdrPage {
  svg: string;
  width: number;
  height: number;
  stats: CdrPageStats;
}
export interface CdrDocument {
  pages: CdrPage[];
  warnings: string[];
}

/** Document units are CSS px at 96dpi. */
export const CDR_MM_TO_PX = 96 / 25.4;
export function cdrMmToPx(mm: number): number {
  return (Number(mm) || 0) * CDR_MM_TO_PX;
}

/** Quick magic check: ZIP (PK) or RIFF CDR/CDRX. */
export function isLikelyCdrBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 4) return false;
  const s = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (s.startsWith('PK')) return true;
  if (s === 'RIFF') return true;
  return false;
}

/**
 * Rewrite a CDR-produced SVG header to 96dpi px sizing for Paper.js import.
 * Keeps viewBox/geometry intact; only width/height attrs change.
 * Also strips the page-level canvas clip (`canvas-clip`): Paper.js imports
 * clipPath content as visible black geometry instead of clipping, and the
 * editor already bounds each page with its own artboard sheet.
 * Per-image bitmap clips (`bitmap-clip-N`) are kept.
 */
export function cdrSvgToImportSvg(svg: string, widthMm: number, heightMm: number): string {
  const w = cdrMmToPx(widthMm);
  const h = cdrMmToPx(heightMm);
  if (!(w > 0) || !(h > 0)) return stripCdrCanvasClip(svg);
  const wAttr = ' width="' + w.toFixed(4) + 'px"';
  const hAttr = ' height="' + h.toFixed(4) + 'px"';
  const out = svg.replace(/<svg\b[^>]*>/, (tag: string) => {
    let t = tag;
    if (/\swidth="[^"]*"/.test(t)) t = t.replace(/\swidth="[^"]*"/, wAttr);
    else t = t.replace(/<svg/, '<svg' + wAttr);
    if (/\sheight="[^"]*"/.test(t)) t = t.replace(/\sheight="[^"]*"/, hAttr);
    else t = t.replace(/<svg/, '<svg' + hAttr);
    return t;
  });
  return approximateCdrPatternsForPaper(stripCdrCanvasClip(out)).svg;
}

/** Count pattern paint-server fills (`fill="url(#...)"`) in a CDR-made SVG. */
export function countCdrUrlFills(svg: string): number {
  if (typeof svg !== 'string') return 0;
  const m = svg.match(/fill="url\(#/g);
  return m ? m.length : 0;
}

/**
 * Replace pattern paint-server fills with solid approximations for Paper.js
 * import (Paper.js cannot render `<pattern>` and falls back to opaque black,
 * so pattern-filled areas would turn into black blobs). The solid color is
 * the pattern motif's primary color extracted from the embedded pixel group
 * (`<g id="pattern-pixels-..."><path fill="...">`), matching the documented
 * "pattern approximated as solid" behavior; unresolvable references become transparent
 * instead of black. No-op when the SVG holds no pattern fills.
 */
export function approximateCdrPatternsForPaper(svg: string): { svg: string; approximated: number } {
  const none = { svg, approximated: 0 };
  if (typeof svg !== 'string' || svg.indexOf('url(#pattern-') < 0) return none;
  const motif = new Map<string, string>();
  const patRe = /<pattern\b[^>]*\bid="(pattern-[^"]+)"[^>]*>([\s\S]*?)<\/pattern>/g;
  let m: RegExpExecArray | null;
  while ((m = patRe.exec(svg)) !== null) {
    const use = /href="#([^"]+)"/.exec(m[2]);
    if (!use) continue;
    const gid = use[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const g = new RegExp('<g\\b[^>]*\\bid="' + gid + '"[^>]*>([\\s\\S]*?)<\\/g>').exec(svg);
    const fill = g && /<path\b[^>]*\bfill="([^"]+)"/.exec(g[1]);
    if (fill && fill[1].indexOf('url(') !== 0) motif.set(m[1], fill[1]);
  }
  let approximated = 0;
  const out = svg.replace(/fill="url\(#(pattern-[^"]+)\)"/g, (full: string, id: string) => {
    const c = motif.get(id);
    approximated++;
    return c ? `fill="${c}"` : 'fill="none"';
  });
  return { svg: out, approximated };
}

/** Remove the page-level `canvas-clip` clipPath and its references. */
export function stripCdrCanvasClip(svg: string): string {
  if (typeof svg !== 'string' || svg.indexOf('canvas-clip') < 0) return svg;
  return svg
    .replace(/<clipPath[^>]*canvas-clip[\s\S]*?<\/clipPath>/g, '')
    .replace(/\sclip-path="url\(#canvas-clip\)"/g, '');
}

/**
 * Viewport scale of an SVG document: viewport px per viewBox unit.
 * CDR pages use huge CDR-unit viewBoxes, so this is far below 1
 * (96dpi: 96/254000). Falls back to the 96dpi CDR constant when the
 * header cannot be parsed.
 */
export function cdrViewBoxScale(svgText: string): number {
  const fallback = 96 / 254000;
  if (typeof svgText !== 'string') return fallback;
  const tag = (svgText.match(/<svg\b[^>]*>/) || [])[0];
  if (!tag) return fallback;
  const vb = tag.match(/viewBox="([^"]+)"/);
  const w = tag.match(/width="([\d.]+)/);
  if (!vb || !w) return fallback;
  const parts = vb[1].trim().split(/[\s,]+/).map(Number);
  const vbW = parts[2];
  const wPx = Number(w[1]);
  if (!(vbW > 0) || !(wPx > 0) || !Number.isFinite(vbW) || !Number.isFinite(wPx)) return fallback;
  return wPx / vbW;
}

/**
 * Scale stroke widths after Paper.js `importSVG`. Paper bakes the
 * viewBox->viewport scale into segment coordinates but keeps raw
 * `stroke-width`/`dashArray` user-unit values, so CDR strokes (thousands
 * of CDR units) would render thousands of px wide and bury every fill.
 * Only items that actually carry a stroke are touched: Paper defaults
 * every item to `strokeWidth: 1`, so scaling unconditionally would leave
 * unstroked shapes with a ~0.0004 px width (breaking later attempts to
 * add a stroke from the Properties panel).
 * Duck-typed (no paper import) so unit tests stay dependency-free.
 */
export function scaleCdrImportedStrokes(root: unknown, scale: number): void {
  if (!(scale > 0) || !Number.isFinite(scale) || scale === 1) return;
  const stack: any[] = Array.isArray(root) ? [...(root as any[])] : [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    try {
      // Groups expose the same style defaults without owning a stroke;
      // touching them would poison inheriting children, so require an
      // explicit stroke color first. (Children are still visited below.)
      if ((node as any).strokeColor != null) {
        if (Number.isFinite((node as any).strokeWidth)) {
          ;(node as any).strokeWidth = (node as any).strokeWidth * scale;
        }
        const dash = (node as any).dashArray;
        if (Array.isArray(dash) && dash.length > 0) {
          ;(node as any).dashArray = dash.map((v: unknown) =>
            Number.isFinite(v as number) ? (v as number) * scale : v,
          );
        }
        if (Number.isFinite((node as any).dashOffset)) {
          ;(node as any).dashOffset = (node as any).dashOffset * scale;
        }
      }
    } catch {
      // Best effort: never break an import for cosmetic scaling.
    }
    const children = (node as any).children;
    if (Array.isArray(children)) {
      for (const c of children) stack.push(c);
    }
  }
}


const CDR = (() => {
        const td = new TextDecoder(),
          view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
        const u = (b, p) => view(b).getUint32(p, true),
          i = (b, p) => view(b).getInt32(p, true),
          d = (b, p) => view(b).getFloat64(p, true);
        const str = (b, p, n) => td.decode(b.subarray(p, p + n));
        const esc = (s) =>
          String(s).replace(
            /[&<>"']/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c],
          );
        const num = (n) => {
          if (!Number.isFinite(n)) throw Error("Invalid numeric coordinate");
          return String(Math.round(n * 1000000) / 1000000);
        };
        const ident = [1, 0, 0, 1, 0, 0];
        // Local copy of the UI yield (kept in sync with src/editor/busy.ts):
        // this module stays import-free so it also runs under plain Node.
        // The timeout guarantees progress even when rAF stalls (hidden tab).
        const yieldToUI = () =>
          new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(finish, 32);
            if (typeof requestAnimationFrame === "function")
              requestAnimationFrame(() => requestAnimationFrame(finish));
          });
        const mul = (a, b) => [
          a[0] * b[0] + a[2] * b[1],
          a[1] * b[0] + a[3] * b[1],
          a[0] * b[2] + a[2] * b[3],
          a[1] * b[2] + a[3] * b[3],
          a[0] * b[4] + a[2] * b[5] + a[4],
          a[1] * b[4] + a[3] * b[5] + a[5],
        ];
        async function unzip(bytes) {
          if (str(bytes, 0, 4) === "RIFF") return unpackCmx(bytes);
          if (bytes.length < 22 || u(bytes, 0) !== 0x04034b50)
            throw Error("Not a valid CDR ZIP file");
          let end = bytes.length - 22;
          while (
            end >= Math.max(0, bytes.length - 65557) &&
            (u(bytes, end) !== 0x06054b50 ||
              end + 22 + view(bytes).getUint16(end + 20, true) !== bytes.length)
          )
            end--;
          if (end < Math.max(0, bytes.length - 65557)) throw Error("ZIP directory corrupted or file incomplete");
          let p = u(bytes, end + 16),
            total = 0;
          const files = {};
          for (let k = 0; k < view(bytes).getUint16(end + 10, true); k++) {
            if (p + 46 > bytes.length || u(bytes, p) !== 0x02014b50) throw Error("Invalid ZIP directory");
            const v = view(bytes),
              method = v.getUint16(p + 10, true),
              size = u(bytes, p + 20),
              length = u(bytes, p + 24),
              nl = v.getUint16(p + 28, true),
              el = v.getUint16(p + 30, true),
              cl = v.getUint16(p + 32, true),
              local = u(bytes, p + 42),
              name = str(bytes, p + 46, nl);
            if (v.getUint16(p + 8, true) & 1) throw Error("Encrypted CDR is not supported");
            p += 46 + nl + el + cl;
            if (!name.startsWith("content/")) continue;
            total += length;
            if (total > 256 * 1024 * 1024) throw Error("Decompressed data exceeds the 256 MB limit");
            if (local + 30 > bytes.length || u(bytes, local) !== 0x04034b50)
              throw Error("ZIP entry corrupted");
            const start =
              local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
            if (start + size > bytes.length) throw Error("ZIP data truncated");
            const packed = bytes.subarray(start, start + size);
            let raw;
            if (method === 0) raw = packed;
            else if (method === 8) {
              if (typeof DecompressionStream === "undefined")
                throw Error("Local decompression is not supported by this browser, please use a recent Chrome or Edge");
              const reader = new Blob([packed])
                  .stream()
                  .pipeThrough(new DecompressionStream("deflate-raw"))
                  .getReader(),
                chunks = [];
              let got = 0;
              for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                got += value.length;
                if (got > length) {
                  await reader.cancel();
                  throw Error("Abnormal ZIP decompressed length");
                }
                chunks.push(value);
              }
              raw = new Uint8Array(got);
              let at = 0;
              for (const c of chunks) {
                raw.set(c, at);
                at += c.length;
              }
            } else throw Error("Unsupported ZIP compression method " + method);
            if (crc32(raw) !== u(bytes, p - 46 - nl - el - cl + 16))
              throw Error("ZIP CRC check failed");
            if (raw.length !== length) throw Error("ZIP decompressed length mismatch");
            files[name] = raw;
          }
          return files;
        }
        async function legacyTree(bytes) {
          if (str(bytes, 0, 4) !== "RIFF" || str(bytes, 8, 4) !== "CDRE")
            throw Error("This legacy entry supports CorelDRAW X4/CDRE only");
          let expanded = 0,
            nodeCount = 0;
          async function inflate(b) {
            try {
              return await inflateExact(b);
            } catch (error) {
              if (b[b.length - 1] !== 0) throw error;
              return inflateExact(b.subarray(0, -1));
            }
          }
          async function inflateExact(b) {
            const reader = new Blob([b])
                .stream()
                .pipeThrough(new DecompressionStream("deflate"))
                .getReader(),
              parts = [];
            let size = 0;
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.length;
              expanded += value.length;
              if (expanded > 256 * 1024 * 1024) {
                await reader.cancel();
                throw Error("Legacy decompressed data exceeds 256 MB");
              }
              parts.push(value);
            }
            const raw = new Uint8Array(size);
            let p = 0;
            for (const part of parts) {
              raw.set(part, p);
              p += part.length;
            }
            return raw;
          }
          async function walk(b, start, end, lengths = [], depth = 0) {
            if (depth > 100) throw Error("Legacy objects nested too deep");
            const nodes = [];
            for (let p = start; p + 8 <= end;) {
              if (++nodeCount > 300000) throw Error("Too many legacy objects");
              const id = str(b, p, 4).trim(),
                index = u(b, p + 4),
                len = lengths[index] ?? index,
                next = p + 8 + len;
              if (next > end) throw Error("Legacy RIFF chunk out of bounds");
              const value = b.subarray(p + 8, next);
              if (id === "LIST") {
                if (len < 4) throw Error("Legacy list corrupted");
                const type = str(value, 0, 4).trim();
                if (type === "cmpr") {
                  if (len < 28 || str(value, 20, 4) !== "CPng") throw Error("Invalid legacy compression header");
                  const size = u(value, 4);
                  if (size > len - 28) throw Error("Legacy compressed block out of bounds");
                  if (size < 8 || str(value, 28 + size - 8, 4) !== "CPng")
                    throw Error("Invalid legacy length-table compression header");
                  const raw = await inflate(value.subarray(28, 28 + size - 8)),
                    table = await inflate(value.subarray(28 + size));
                  if (table.length % 4) throw Error("Invalid legacy length table");
                  nodes.push(
                    ...(await walk(
                      raw,
                      0,
                      raw.length,
                      Array.from({ length: table.length / 4 }, (_, k) => u(table, k * 4)),
                      depth + 1,
                    )),
                  );
                } else if (type === "stlt") nodes.push({ id: type, bytes: value.subarray(4) });
                else
                  nodes.push({
                    id: type,
                    children: await walk(value, 4, value.length, lengths, depth + 1),
                  });
              } else nodes.push({ id, bytes: value });
              p = next + (len & 1);
            }
            return nodes;
          }
          if (u(bytes, 4) + 8 > bytes.length) throw Error("Legacy CDR file truncated");
          return walk(bytes, 12, u(bytes, 4) + 8);
        }

        async function parse(files, onProgress) {
          if (files.cmx) return parseCmx(files.cmx, onProgress);
          const legacy = Boolean(files["content/riffData.cdr"]);
          const root = files["content/root.dat"] || files["content/riffData.cdr"],
            list = files["content/dataFileList.dat"];
          if (!root || (!list && !legacy)) throw Error("Missing CDR object tree or data file list");
          if (str(root, 0, 4) !== "RIFF") throw Error("root.dat is not a RIFF object tree");
          const names = td
              .decode(list || new Uint8Array())
              .trim()
              .split(/\r?\n/),
            warnings = new Map();
          const warn = (s) => warnings.set(s, (warnings.get(s) || 0) + 1);
          function ref(b) {
            if (legacy) return b;
            if (b.length !== 16) throw Error("Unsupported CDR data reference");
            const index = u(b, 0),
              len = u(b, 4),
              off = u(b, 8);
            if (index === 0xffffffff) {
              if (len > 8) throw Error("Inline record corrupted");
              return b.subarray(8, 8 + len);
            }
            const data = files["content/data/" + names[index]];
            if (!data || off + len > data.length) throw Error("CDR data reference out of bounds");
            return data.subarray(off, off + len);
          }
          let nodes = 0;
          function chunks(b, start, end, depth = 0) {
            if (depth > 100) throw Error("Objects nested too deep");
            const out = [];
            for (let p = start; p + 8 <= end;) {
              if (++nodes > 300000) throw Error("Object count exceeds the limit");
              const id = str(b, p, 4).trim(),
                len = u(b, p + 4),
                next = p + 8 + len;
              if (next > end) throw Error("RIFF record truncated");
              if (id === "LIST") {
                if (len < 4) throw Error("RIFF list corrupted");
                out.push({
                  id: str(b, p + 8, 4).trim(),
                  children: chunks(b, p + 12, next, depth + 1),
                });
              } else out.push({ id, bytes: b.subarray(p + 8, next) });
              p = next + (len & 1);
            }
            return out;
          }
          const tree = legacy
            ? await legacyTree(root)
            : chunks(root, 12, Math.min(root.length, u(root, 4) + 8));
          // Object census for determinate progress (cheap structural walk,
          // no geometry decoding). render() reports against this total.
          let totalObjects = 0;
          {
            const stack = [...tree];
            while (stack.length > 0) {
              const node = stack.pop();
              if (!node) continue;
              if (node.id === "obj") totalObjects++;
              if (node.children) for (const c of node.children) stack.push(c);
            }
          }
          let doneObjects = 0;
          if (onProgress) onProgress(0.1);
          await yieldToUI();
          const child = (n, id) => n.children?.find((c) => c.id === id);
          const data = (n, id) => {
            const c = child(n, id);
            return c ? ref(c.bytes) : null;
          };
          function loda(b) {
            if (!b || b.length < 20) return null;
            const count = u(b, 4),
              oa = u(b, 8),
              ot = u(b, 12);
            if (count > 10000 || oa + count * 4 > b.length || ot + count * 4 > b.length)
              throw Error("loda parameter table corrupted");
            const args = {};
            for (let k = 0; k < count; k++) {
              const start = u(b, oa + 4 * k),
                end = k + 1 < count ? u(b, oa + 4 * k + 4) : u(b, 0);
              if (start > end || end > b.length) throw Error("loda parameter out of bounds");
              args[u(b, ot + 4 * (count - 1 - k))] = b.subarray(start, end);
            }
            return { type: u(b, 16), args };
          }
          function jsons(b) {
            const out = [];
            for (let p = 0; p + 4 < b.length; p++) {
              const len = u(b, p);
              if (len < 2 || p + 4 + len > b.length || b[p + 4] !== 123 || b[p + 3 + len] !== 125)
                continue;
              try {
                out.push({ obj: JSON.parse(str(b, p + 4, len)), end: p + 4 + len });
                p += 3 + len;
              } catch {}
            }
            return out;
          }
          function matrix(n) {
            let m = ident;
            const lg = child(n, "lgob"),
              tr = lg && child(lg, "trfl");
            for (const c of tr?.children || []) {
              if (c.id !== "trfd") continue;
              const b = ref(c.bytes),
                count = u(b, 4),
                oa = u(b, 8);
              if (count > 1000 || oa + count * 4 > b.length) throw Error("Transform record corrupted");
              for (let k = 0; k < count; k++) {
                const p = u(b, oa + k * 4) + 8;
                if (p + 56 > b.length) throw Error("Transform matrix out of bounds");
                if (view(b).getUint16(p, true) !== 8) {
                  warn("Unsupported special transform");
                  continue;
                }
                const q = p + 8;
                m = mul(m, [
                  d(b, q),
                  d(b, q + 24),
                  d(b, q + 8),
                  d(b, q + 32),
                  d(b, q + 16),
                  d(b, q + 40),
                ]);
              }
            }
            return m;
          }
          function color(s) {
            if (!s) return "none";
            const a = String(s).split(","),
              v = a.slice(2, 6).map(Number),
              clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
            if (a[0] === "RGB255")
              return (
                "#" +
                v
                  .slice(0, 3)
                  .map((x) => clamp(x).toString(16).padStart(2, "0"))
                  .join("")
              );
            if (a[0] === "CMYK255") {
              v.splice(0, 4, ...v.map((x) => (x * 100) / 255));
              a[0] = "CMYK";
            }
            if (a[0] === "CMYK")
              return (
                "rgb(" +
                v
                  .slice(0, 3)
                  .map((x) => clamp(255 * (1 - x / 100) * (1 - v[3] / 100)))
                  .join(",") +
                ")"
              );
            if (a[0] === "Gray")
              return (
                "rgb(" +
                Array(3)
                  .fill(clamp((255 * v[0]) / 100))
                  .join(",") +
                ")"
              );
            warn("Unsupported color model " + a[0]);
            return "#000000";
          }
          function style(s, fillOverride = null) {
            const f = s.fill || {},
              o = s.outline || {},
              w = Math.max(0, Number(o.width) || 0);
            if (!fillOverride && f.type && !["0", "1"].includes(String(f.type)))
              warn("Gradient/pattern fill approximated as solid");
            if (Object.keys(s.transparency || {}).length) warn("Transparency effects not fully parsed");
            if (
              (o.leftArrow && !o.leftArrow.endsWith("|0")) ||
              (o.rightArrow && !o.rightArrow.endsWith("|0"))
            )
              warn("Arrowheads not rendered");
            let a = `fill="${fillOverride || (String(f.type) === "0" ? "none" : color(f.primaryColor))}" stroke="${w ? color(o.color) : "none"}" stroke-width="${num(w)}" stroke-linecap="${["butt", "round", "square"][Number(o.endCaps)] || "butt"}" stroke-linejoin="${["miter", "round", "bevel"][Number(o.joinType)] || "miter"}"`;
            const dash = String(o.dashDotSpec || "0")
                .split(",")
                .map(Number),
              parts = dash.slice(1, 1 + dash[0]);
            if (parts.length && parts.every((x) => x > 0 && Number.isFinite(x)))
              a += ` stroke-dasharray="${parts.map((x) => num(x * w)).join(" ")}"`;
            return a;
          }
          function curve(b) {
            const count = view(b).getUint16(0, true);
            if (4 + 9 * count > b.length) throw Error("Invalid curve path point count");
            let path = [],
              control = [],
              closed = false;
            for (let k = 0; k < count; k++) {
              const xy = `${i(b, 4 + 8 * k)} ${i(b, 8 + 8 * k)}`,
                flag = b[4 + 8 * count + k],
                kind = flag & 192;
              if (kind === 192) {
                control.push(xy);
                continue;
              }
              if (kind === 0) {
                if (closed && path.at(-1) !== "Z") path.push("Z");
                closed = Boolean(flag & 8);
                path.push("M " + xy);
                control = [];
              } else {
                path.push(
                  kind === 128 && control.length === 2
                    ? "C " + control.join(" ") + " " + xy
                    : "L " + xy,
                );
                control = [];
                if (flag & 8) path.push("Z");
              }
            }
            if (closed && path.at(-1) !== "Z") path.push("Z");
            return path.join(" ");
          }
          function rectangle(b) {
            if (legacy) {
              const w = i(b, 0),
                h = i(b, 4);
              if (b.length >= 24 && [8, 12, 16, 20].some((p) => i(b, p) !== 0))
                warn("Legacy rounded rectangles treated as square");
              return `M0 0 L0 ${h} L${w} ${h} L${w} 0 Z`;
            }
            if (b.length < 128) throw Error("Incomplete rectangle data");
            const w = d(b, 0),
              h = d(b, 8),
              sx = d(b, 16) || 1,
              sy = d(b, 24) || 1,
              absolute = b[32] !== 0,
              corner = b[48],
              r = [112, 88, 64, 40].map((p) =>
                Math.max(
                  0,
                  d(b, p) * (absolute ? 1 : Math.min(Math.abs(w * sx), Math.abs(h * sy)) / 2),
                ),
              );
            let pts = [
                [0, 0],
                [0, h],
                [w, h],
                [w, 0],
              ],
              path = [];
            for (let k = 0; k < 4; k++) {
              const c = pts[k],
                prev = pts[(k + 3) % 4],
                next = pts[(k + 1) % 4],
                dist = Math.min(r[k], Math.abs(w * sx) / 2, Math.abs(h * sy) / 2),
                along = (p) => [
                  c[0] + (Math.sign(p[0] - c[0]) * dist) / Math.abs(sx),
                  c[1] + (Math.sign(p[1] - c[1]) * dist) / Math.abs(sy),
                ],
                a = along(prev),
                z = along(next);
              path.push((k ? "L " : "M ") + a.map(num).join(" "));
              if (dist && corner !== 2) {
                const q = corner === 1 ? [a[0] + z[0] - c[0], a[1] + z[1] - c[1]] : c;
                path.push("Q " + q.map(num).join(" ") + " " + z.map(num).join(" "));
              } else path.push("L " + z.map(num).join(" "));
            }
            return path.join(" ") + " Z";
          }
          function ellipse(b) {
            if (b.length < 20) throw Error("Incomplete ellipse data");
            const cx = i(b, 0) / 2,
              cy = i(b, 4) / 2,
              rx = Math.abs(cx),
              ry = Math.abs(cy),
              a = (i(b, 8) * Math.PI) / 180000000,
              z = (i(b, 12) * Math.PI) / 180000000,
              point = (t) => [cx + rx * Math.cos(t), cy - ry * Math.sin(t)].map(num).join(" ");
            if (a === z)
              return `M ${num(cx + rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(cx - rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(cx + rx)} ${num(cy)} Z`;
            const delta = (((z - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            return (
              `M ${point(a)} A ${num(rx)} ${num(ry)} 0 ${delta > Math.PI ? 1 : 0} 0 ${point(z)}` +
              (u(b, 16) ? ` L ${num(cx)} ${num(cy)} Z` : "")
            );
          }
          function textRuns(b) {
            const runs = [];
            let ch = {},
              paragraph = {},
              base = {},
              styles = [];
            for (const r of jsons(b)) {
              if (r.obj.paragraph) {
                paragraph = { ...paragraph, ...r.obj.paragraph };
                base = {};
                styles = [];
              }
              const merge = (a, b) =>
                Object.fromEntries(
                  [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [
                    k,
                    b[k] && typeof b[k] === "object" ? { ...a[k], ...b[k] } : (b[k] ?? a[k]),
                  ]),
                );
              if (!r.obj.character) continue;
              if (r.obj.paragraph) {
                base = merge(base, r.obj.character);
                ch = base;
              } else {
                ch = merge(base, r.obj.character);
                styles.push(ch);
              }
              const p = r.end;
              if (p + 8 > b.length) continue;
              const count = u(b, p),
                bp = p + 4 + 8 * count;
              if (!count || count > 100000 || bp + 4 > b.length) continue;
              const bytes = u(b, bp);
              if (bytes < count || bytes > 2 * count || bp + 4 + bytes > b.length) continue;
              let at = bp + 4,
                text = "",
                characters = [];
              for (let k = 0; k < count; k++) {
                const wide = u(b, p + 4 + 8 * k) & 1;
                if (at + 1 + wide > bp + 4 + bytes) {
                  text = "";
                  break;
                }
                const char = String.fromCharCode(wide ? view(b).getUint16(at, true) : b[at]);
                const index = u(b, p + 4 + 8 * k) >>> 17;
                const style = styles[index] || base;
                text += char;
                characters.push({ text: char, ch: style });
                at += 1 + wide;
              }
              if (text && at === bp + 4 + bytes)
                runs.push({ text, ch: { ...base }, characters, paragraph: { ...paragraph } });
            }
            return runs;
          }
          function legacyColor(b, p) {
            const model = view(b).getUint16(p, true),
              v = Array.from(b.subarray(p + 8, p + 12));
            if (model === 5) return "RGB255,USER," + [v[2], v[1], v[0], 100].join(",");
            // Model 17 is CMYK with 0-255 components (same layout as model 3):
            // white is [0,0,0,0], black is [0,0,0,255] (seen on uniform garment
            // fills and outlines in X4 production files). It must not fall into
            // the black fallback below, or white fills render as black blobs.
            if (model === 2 || model === 3 || model === 17)
              return (model === 2 ? "CMYK" : "CMYK255") + ",USER," + v.join(",") + ",100";
            warn("Unsupported legacy color model " + model);
            return "RGB255,USER,0,0,0,100";
          }
          const legacyFills = new Map(),
            legacyOutlines = new Map(),
            legacyFonts = new Map();
          function legacyTables(nodes) {
            for (const n of nodes) {
              const b = n.bytes;
              if (b && n.id === "fild") {
                const type = view(b).getUint16(12, true);
                legacyFills.set(u(b, 0), {
                  type: String(type),
                  primaryColor: type === 1 ? legacyColor(b, 27) : undefined,
                });
              }
              if (b && n.id === "font") {
                legacyFonts.set(view(b).getUint16(0, true), {
                  font: new TextDecoder("utf-16le").decode(b.subarray(18)).split("\0")[0],
                  charset: String(view(b).getUint16(2, true)),
                });
              }
              if (b && n.id === "outl") {
                let p = 4;
                while (p + 8 <= b.length) {
                  const id = u(b, p),
                    len = u(b, p + 4);
                  p += 8;
                  if (id === 1) break;
                  p += len;
                }
                if (p + 64 + 12 > b.length) throw Error("Legacy outline style corrupted");
                const flags = view(b).getUint16(p, true),
                  dashPos = p + 64 + 12 + 16,
                  count = view(b).getUint16(dashPos, true),
                  dash = Array.from({ length: count }, (_, k) =>
                    view(b).getUint16(dashPos + 2 + 2 * k, true),
                  );
                legacyOutlines.set(u(b, 0), {
                  type: String(flags),
                  width: String(flags & 1 ? 0 : i(b, p + 6)),
                  scaleWithObject: flags & 32 ? "1" : "0",
                  endCaps: String(view(b).getUint16(p + 2, true)),
                  joinType: String(view(b).getUint16(p + 4, true)),
                  color: legacyColor(b, p + 64),
                  dashDotSpec: [count, ...dash].join(","),
                });
              }
              if (n.children) legacyTables(n.children);
            }
          }
          if (legacy) legacyTables(tree);
          const legacyTextStyles = new Map();
          function readOldStyleTable(b) {
            let p = 0;
            const long = () => {
                const v = u(b, p);
                p += 4;
                return v;
              },
              skip = (n) => {
                p += n;
                if (p > b.length) throw Error("Legacy style table out of bounds");
              };
            const count = long(),
              fills = new Map(),
              outlines = new Map(),
              fonts = new Map(),
              aligns = new Map();
            let n = long();
            for (let k = 0; k < n; k++) {
              const id = long();
              skip(4);
              fills.set(id, long());
              skip(48);
            }
            n = long();
            for (let k = 0; k < n; k++) {
              const id = long();
              skip(4);
              outlines.set(id, long());
            }
            n = long();
            for (let k = 0; k < n; k++) {
              const id = long();
              skip(20);
              const font = view(b).getUint16(p, true),
                charset = view(b).getUint16(p + 2, true);
              skip(12);
              const size = long();
              fonts.set(id, {
                ...legacyFonts.get(font),
                charset: String(charset || legacyFonts.get(font)?.charset || 0),
                size: String(size),
              });
              skip(20);
            }
            n = long();
            for (let k = 0; k < n; k++) {
              const id = long();
              skip(4);
              aligns.set(id, long());
            }
            for (const size of [52, 152, 784]) skip(long() * size);
            n = long();
            for (let k = 0; k < n; k++) {
              skip(44);
              const flag = long();
              skip(flag ? 68 : 12);
            }
            skip(long() * 28);
            skip(long() * 36);
            skip(long() * 28);
            skip(long() * 12);
            const records = new Map();
            for (let k = 0; k < count; k++) {
              const num = long(),
                id = long(),
                parent = long();
              skip(8);
              skip(long() * 2);
              const fill = fills.get(long()),
                outline = outlines.get(long());
              let font, justify;
              if (num > 1) {
                font = fonts.get(long());
                justify = aligns.get(long());
                skip(12);
              }
              if (num > 2) skip(20);
              records.set(id, { parent, font, justify, fill, outline });
            }
            function resolve(id, seen = new Set()) {
              if (legacyTextStyles.has(id)) return legacyTextStyles.get(id);
              if (seen.has(id)) throw Error("Legacy style circular reference");
              seen.add(id);
              const r = records.get(id);
              if (!r) return {};
              const parent = resolve(r.parent, seen),
                style = {
                  font: { ...parent.font, ...r.font },
                  paragraph: {
                    ...parent.paragraph,
                    ...(r.justify === undefined ? {} : { justify: String(r.justify) }),
                  },
                  fill: legacyFills.get(r.fill) || parent.fill,
                  outline: legacyOutlines.get(r.outline) || parent.outline,
                };
              legacyTextStyles.set(id, style);
              return style;
            }
            for (const id of records.keys()) resolve(id);
          }
          function oldStyleTables(nodes) {
            for (const n of nodes) {
              if (n.id === "stlt" && n.bytes) readOldStyleTable(n.bytes);
              if (n.children) oldStyleTables(n.children);
            }
          }
          if (legacy) oldStyleTables(tree);

          function oldTextRuns(b, objectStyle) {
            let p = 0;
            const word = () => {
                const n = view(b).getUint16(p, true);
                p += 2;
                return n;
              },
              long = () => {
                const n = u(b, p);
                p += 4;
                return n;
              },
              skip = (n) => {
                p += n;
                if (p > b.length) throw Error("Legacy text out of bounds");
              };
            const frame = long();
            skip(32);
            const frames = long();
            if (frames > 10000) throw Error("Abnormal legacy text frame count");
            for (let k = 0; k < frames; k++) {
              skip(52);
              const onPath = long();
              if (onPath === 1) skip(40);
              if (!frame) skip(36);
            }
            const paragraphs = long(),
              runs = [];
            if (paragraphs > 10000) throw Error("Abnormal legacy paragraph count");
            for (let k = 0; k < paragraphs; k++) {
              const baseStyle = legacyTextStyles.get(long()) || {};
              skip(1 + (frame ? 1 : 0));
              const count = long(),
                styles = [];
              if (count > 10000) throw Error("Abnormal legacy style count");
              for (let j = 0; j < count; j++) {
                word();
                const flags = b[p++],
                  extra = b[p++];
                let font = { ...baseStyle.font },
                  fill = baseStyle.fill || objectStyle.fill,
                  outline = baseStyle.outline || objectStyle.outline;
                if (flags & 1) {
                  font = { ...font, ...legacyFonts.get(word()) };
                  const charset = word();
                  if (charset) font.charset = String(charset);
                }
                if (flags & 2) skip(4);
                if (flags & 4) font.size = String(long());
                for (const flag of [8, 16, 32]) if (flags & flag) skip(4);
                if (flags & 64) {
                  fill = legacyFills.get(long());
                  skip(48);
                }
                if (flags & 128) outline = legacyOutlines.get(long());
                if (extra & 8) skip(long() * 2);
                if (extra & 32 && b[p]) skip(4);
                styles.push({ latin: font, farEast: font, RTL: font, fill, outline });
              }
              const chars = long(),
                start = p;
              if (chars > 100000 || p + chars * 8 > b.length) throw Error("Legacy character table corrupted");
              skip(chars * 8);
              const length = long(),
                end = p + length;
              if (end > b.length) throw Error("Legacy text truncated");
              let text = "",
                characters = [];
              for (let j = 0; j < chars; j++) {
                const flag = u(b, start + 8 * j),
                  wide = flag & 1;
                if (p + 1 + wide > end) throw Error("Abnormal legacy character encoding length");
                const value = wide ? view(b).getUint16(p, true) : b[p];
                p += 1 + wide;
                const ch = styles[flag >>> 17] || styles[0] || {};
                if (!ch.latin?.size) warn("Legacy text has no explicit size, using default size");
                const t = String.fromCharCode(value);
                text += t;
                characters.push({ text: t, ch });
              }
              p = end;
              skip(1);
              runs.push({
                text,
                characters,
                ch: styles[0] || {},
                paragraph: baseStyle.paragraph || {},
              });
            }
            return runs;
          }

          const bitmaps = new Map();
          async function loadBitmaps(nodes) {
            for (const n of nodes) {
              if (n.id === "bmp" && n.bytes) {
                const b = ref(n.bytes);
                const uri = await bitmapPNG(b);
                if (uri) bitmaps.set(u(b, 0), uri);
              }
              if (n.children) await loadBitmaps(n.children);
            }
          }
          await loadBitmaps(tree);
          const patterns = new Map(),
            patternFills = new Map();
          function collectPatterns(nodes) {
            for (const n of nodes) {
              if (n.bytes && n.id === "bmpf") {
                const b = ref(n.bytes);
                if (b.length >= 52 && u(b, 4) === 40 && view(b).getUint16(18, true) === 1) {
                  const width = u(b, 8),
                    height = u(b, 12),
                    length = u(b, 24),
                    start = b.length - length,
                    stride = length / height;
                  if (
                    width &&
                    height &&
                    width * height <= 65536 &&
                    stride >= Math.ceil(width / 8) &&
                    Number.isInteger(stride) &&
                    start >= 44
                  ) {
                    let path = [];
                    for (let y = 0; y < height; y++) {
                      let startX = -1;
                      for (let x = 0; x <= width; x++) {
                        const on =
                          x < width &&
                          !(b[start + (height - 1 - y) * stride + (x >> 3)] & (128 >> (x & 7)));
                        if (on && startX < 0) startX = x;
                        if (!on && startX >= 0) {
                          path.push(`M${startX} ${y}h${x - startX}v1h${startX - x}z`);
                          startX = -1;
                        }
                      }
                    }
                    patterns.set(u(b, 0), { width, height, path: path.join(" ") });
                  }
                }
              } else if (n.bytes && n.id === "fild") {
                const b = ref(n.bytes);
                if (b.length >= 34 && view(b).getUint16(12, true) === 7)
                  patternFills.set(u(b, 0), u(b, 22));
              }
              if (n.children) collectPatterns(n.children);
            }
          }
          collectPatterns(tree);
          if (onProgress) onProgress(0.25);
          await yieldToUI();
          let definitions = [],
            pixelDefs = new Set();
          function patternFill(n, l, s, id) {
            if (String(s.fill?.type) !== "7" || !l.args[20]) return null;
            const fillId = u(l.args[20], 0),
              pattern = patterns.get(patternFills.get(fillId));
            if (!pattern) return null;
            const f = s.fill,
              w = Number(f.tilingWidth),
              h = Number(f.tilingHeight);
            if (!(w > 0 && h > 0)) return null;
            const key = "pattern-pixels-" + fillId;
            if (!pixelDefs.has(key)) {
              pixelDefs.add(key);
              definitions.push(
                `<g id="${key}"><rect width="${pattern.width}" height="${pattern.height}" fill="${color(f.secondaryColor)}"/><path d="${pattern.path}" fill="${color(f.primaryColor)}"/></g>`,
              );
            }
            const ft = data(child(n, "lgob"), "ftil"),
              m =
                ft && ft.length >= 48
                  ? [d(ft, 0), d(ft, 24), d(ft, 8), d(ft, 32), d(ft, 16), d(ft, 40)]
                  : ident;
            definitions.push(
              `<pattern id="pattern-${id}" patternUnits="userSpaceOnUse" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${pattern.width} ${pattern.height}" patternTransform="matrix(${m.map(num).join(" ")})"><use href="#${key}"/></pattern>`,
            );
            if (
              Number(f.angle) ||
              Number(f.skew) ||
              f.tilingFlagsMirrorHorizontal === "1" ||
              f.tilingFlagsMirrorVertical === "1"
            )
              warn("Pattern rotation/mirror attributes not fully parsed");
            return `url(#pattern-${id})`;
          }

          let objectId = 0;
          const pages = [];
          const documentConfig = data(tree.find((node) => node.id === "doc") || {}, "mcfg");
          const defaultPageSize =
            documentConfig?.length >= 20 ? [i(documentConfig, 12), i(documentConfig, 16)] : null;
          async function page(n) {
            definitions = [];
            pixelDefs = new Set();
            const bb = data(n, "bbox");
            let bounds =
              bb && bb.length >= 16
                ? Array.from({ length: 4 }, (_, k) => i(bb, k * 4))
                : [0, 0, 0, 0];
            // bbox is artwork extent, not the CorelDRAW canvas. Page settings override it.
            const pageGeometry = loda(data(child(n, "lgob") || {}, "loda"));
            const sizeRecord = pageGeometry?.args[0x4aba];
            const pageSize =
              sizeRecord?.length >= 8 ? [i(sizeRecord, 0), i(sizeRecord, 4)] : defaultPageSize;
            const hasCanvas =
              pageSize && pageSize.every((value) => Number.isFinite(value) && value > 0);
            if (hasCanvas)
              bounds = [-pageSize[0] / 2, pageSize[1] / 2, pageSize[0] / 2, -pageSize[1] / 2];
            const stats = { objects: 0, shapes: 0, texts: 0, images: 0, skipped: 0, outside: 0 };
            let fallback = [];
            async function render(n) {
              if (!n.children) return "";
              if (n.id === "obj") {
                stats.objects++;
                // Keep the main thread alive on huge pages: report progress
                // and yield every 25 objects so the loading UI can repaint.
                if (++doneObjects % 25 === 0 || doneObjects >= totalObjects) {
                  if (onProgress)
                    onProgress(
                      0.25 +
                        (0.7 * Math.min(doneObjects, totalObjects)) /
                          Math.max(1, totalObjects),
                    );
                  await yieldToUI();
                }
                const id = ++objectId,
                  lg = child(n, "lgob"),
                  l = loda(lg && data(lg, "loda")),
                  bbox = data(n, "bbox");
                if (bbox?.length >= 16)
                  fallback.push(Array.from({ length: 4 }, (_, k) => i(bbox, k * 4)));
                if (!l) {
                  stats.skipped++;
                  warn("Object missing geometry record");
                  return "";
                }
                const inherited =
                  legacy && l.args[200] ? legacyTextStyles.get(u(l.args[200], 0)) || {} : {};
                const s = legacy
                    ? {
                        fill: legacyFills.get(l.args[20] ? u(l.args[20], 0) : 0) ||
                          inherited.fill || { type: "0" },
                        outline:
                          legacyOutlines.get(l.args[10] ? u(l.args[10], 0) : 0) ||
                          inherited.outline ||
                          {},
                      }
                    : jsons(l.args[201] || l.args[10] || new Uint8Array())[0]?.obj || {},
                  m = matrix(n),
                  attr = `data-cdr-object="${id}" transform="matrix(${m.map(num).join(" ")})"`;
                if (hasCanvas && bbox?.length >= 16) {
                  const box = Array.from({ length: 4 }, (_, k) => i(bbox, k * 4));
                  // Leave borderline outlines to the exact viewport clip instead of dropping them.
                  const margin =
                    Math.max(0, Number(s.outline?.width) || 0) *
                    Math.max(1, Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
                  if (
                    Math.max(box[0], box[2]) + margin < bounds[0] ||
                    Math.min(box[0], box[2]) - margin > bounds[2] ||
                    Math.max(box[1], box[3]) + margin < bounds[3] ||
                    Math.min(box[1], box[3]) - margin > bounds[1]
                  ) {
                    stats.outside++;
                    return "";
                  }
                }
                if (l.type === 4 || l.type === 6) {
                  const tx = data(n, "txsm");
                  const runs = tx ? (legacy ? oldTextRuns(tx, s) : textRuns(tx)) : [];
                  if (!runs.length) {
                    stats.skipped++;
                    warn("Objects with unextractable text");
                    return "";
                  }
                  if (runs.length > 1) warn("Multi-paragraph line spacing approximated by font size");
                  // Render fonts in ordinary pixel units, not tens of thousands of CDR units.
                  const textUnit = 254000 / 300;
                  let y = 0;
                  const out = [];
                  for (const r of runs) {
                    stats.texts++;
                    const characters = [...r.characters];
                    // Artistic text matrices anchor the first visible line. Boundary CRs are not extra baseline advances.
                    if (l.type === 4) {
                      while (characters.length && /[\r\n]/.test(characters[0].text))
                        characters.shift();
                      while (
                        characters.length &&
                        /[\r\n]/.test(characters[characters.length - 1].text)
                      )
                        characters.pop();
                    }
                    const lines = [[]];
                    let previousCR = false;
                    for (const character of characters) {
                      if (character.text === "\r" || character.text === "\n") {
                        if (!(character.text === "\n" && previousCR)) lines.push([]);
                        previousCR = character.text === "\r";
                        continue;
                      }
                      previousCR = false;
                      for (const part of fontSegments(character.text, character.ch)) {
                        const line = lines[lines.length - 1],
                          last = line[line.length - 1];
                        const key = part.key + JSON.stringify(character.ch.fill || {});
                        if (last && last.key === key) last.text += part.text;
                        else line.push({ ...part, key, ch: character.ch });
                      }
                    }
                    const latin = r.ch.latin || r.ch.farEast || {},
                      latinSize = Number(latin.size) || 31750;
                    const spaceWidth = fontSpaceWidth(latin.font || "宋体", latinSize / textUnit);
                    const letterSpacing =
                      (spaceWidth * (Number(r.paragraph?.interCharSpacing) || 0)) / 1000000;
                    const wordSpacing =
                      spaceWidth *
                      ((Number(r.paragraph?.interWordSpacing) || 1000000) / 1000000 - 1);
                    for (const segments of lines) {
                      const first = segments[0] || {
                        size: Number(r.ch.farEast?.size) || 31750,
                        font: {},
                        ch: r.ch,
                        text: "",
                      };
                      const size = Math.max(first.size, ...segments.map((p) => p.size));
                      const attrs = (part) =>
                        `font-size="${num(part.size / textUnit)}px" font-family="${esc(part.font.font || "宋体")}" font-weight="normal" fill="${color(part.ch.fill?.primaryColor || s.fill?.primaryColor)}"${Number(part.ch.outline?.width) > 0 ? ` stroke="${color(part.ch.outline.color)}" stroke-width="${num(Number(part.ch.outline.width) / textUnit)}"` : ""}${part.font.italic === "1" ? ' font-style="italic"' : ""}`;
                      const content =
                        segments.length === 1
                          ? esc(first.text)
                          : segments
                              .map((part) => `<tspan ${attrs(part)}>${esc(part.text)}</tspan>`)
                              .join("");
                      const anchor =
                        String(r.paragraph?.justify) === "2"
                          ? "middle"
                          : String(r.paragraph?.justify) === "3"
                            ? "end"
                            : "start";
                      out.push(
                        `<text xml:space="preserve" letter-spacing="${num(letterSpacing)}" word-spacing="${num(wordSpacing)}" text-anchor="${anchor}" x="0" y="${num(y / textUnit)}" data-cdr-line-y="${num(y / textUnit)}" ${attrs(first)}>${content}</text>`,
                      );
                      const spacing = Number(r.paragraph?.interLineSpacing) / 1000000;
                      y += size * (spacing > 0 ? spacing : 1.2);
                    }
                  }
                  return `<g ${attr}><g transform="matrix(${num(textUnit)} 0 0 ${num(-textUnit)} 0 0)">${out.join("")}</g></g>`;
                }
                const b = l.args[30];
                let path;
                if (b && l.type === 5) {
                  if (b.length < 76) throw Error("Incomplete bitmap object record");
                  const uri = bitmaps.get(u(b, 48));
                  if (!uri) {
                    stats.skipped++;
                    warn("Unsupported bitmap pixel format");
                    return "";
                  }
                  const x1 = i(b, 0),
                    y1 = i(b, 4),
                    x2 = i(b, 8),
                    y2 = i(b, 12),
                    clip = curve(b.subarray(72));
                  stats.images++;
                  return `<g ${attr}><defs><clipPath id="bitmap-clip-${id}"><path d="${clip}"/></clipPath></defs><g clip-path="url(#bitmap-clip-${id})"><image href="${uri}" width="1" height="1" preserveAspectRatio="none" transform="matrix(${x2 - x1} 0 0 ${y2 - y1} ${x1} ${y1})"/></g></g>`;
                }
                if (b && l.type === 3) path = curve(b);
                else if (b && l.type === 1) path = rectangle(b);
                else if (b && l.type === 2) path = ellipse(b);
                else {
                  stats.skipped++;
                  warn("Unsupported object type " + l.type + (l.type === 5 ? "(bitmap)" : ""));
                  return "";
                }
                stats.shapes++;
                // Corel leaves open curves unfilled; SVG otherwise closes them implicitly for fill.
                const fillStyle =
                  /(?:^|\s)Z(?:\s|$)/i.test(path) || String(s.fill?.type) !== "1"
                    ? s
                    : { ...s, fill: { ...s.fill, type: "0" } };
                // Old outlines can explicitly keep their width while geometry is stretched.
                let pathAttributes = attr;
                if (legacy && l.type === 3 && s.outline?.scaleWithObject === "0") {
                  path = path.replace(
                    /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
                    (_, x, y) =>
                      num(m[0] * Number(x) + m[2] * Number(y) + m[4]) +
                      " " +
                      num(m[1] * Number(x) + m[3] * Number(y) + m[5]),
                  );
                  pathAttributes = `data-cdr-object="${id}" transform="matrix(1 0 0 1 0 0)"`;
                }
                return `<path ${pathAttributes} d="${path}" ${style(fillStyle, patternFill(n, l, fillStyle, id))}/>`;
              }
              // Sequential awaits preserve the exact pre-async paint order
              // (object ids, pattern definitions and warnings stay stable).
              const parts = [];
              for (const c of (n.children || []).slice().reverse()) parts.push(await render(c));
              const body = parts.join("\n");
              if (n.id === "grp") {
                // Modern CDR objects already carry document-space transforms.
                // Group trfd records describe editing history, not another SVG transform.
                return `<g>${body}</g>`;
              }
              return body;
            }
            const body = await render(n);
            if (bounds[0] === bounds[2] || bounds[1] === bounds[3]) {
              if (!fallback.length) throw Error("Page has no valid size");
              bounds = [
                Math.min(...fallback.map((b) => Math.min(b[0], b[2]))),
                Math.max(...fallback.map((b) => Math.max(b[1], b[3]))),
                Math.max(...fallback.map((b) => Math.max(b[0], b[2]))),
                Math.min(...fallback.map((b) => Math.min(b[1], b[3]))),
              ];
              warn("Page bounds empty, using object bounds");
            }
            const x = Math.min(bounds[0], bounds[2]),
              y = Math.max(bounds[1], bounds[3]),
              w = Math.abs(bounds[2] - bounds[0]),
              h = Math.abs(bounds[3] - bounds[1]);
            if (!w || !h) throw Error("Invalid page size");
            const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${num((w * 300) / 254000)}px" height="${num((h * 300) / 254000)}px" viewBox="0 0 ${num(w)} ${num(h)}" fill-rule="evenodd" xml:space="preserve" text-rendering="geometricPrecision" shape-rendering="geometricPrecision">\n<defs>${definitions.join("\n")}<clipPath id="canvas-clip" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${num(w)}" height="${num(h)}"/></clipPath></defs>\n<g clip-path="url(#canvas-clip)"><g transform="matrix(1 0 0 -1 ${num(-x)} ${num(y)})">${body}</g></g>\n</svg>`;
            return { svg, width: w / 10000, height: h / 10000, stats };
          }
          for (const n of tree.filter((n) => n.id === "page")) {
            const flags = data(n, "flgs");
            if (flags && u(flags, 0) & 0x10000) continue;
            pages.push(await page(n));
          }
          if (onProgress) onProgress(1);
          await yieldToUI();
          if (!pages.length) throw Error("No convertible pages found");
          return { pages, warnings: [...warnings].map(([s, n]) => `${s} (${n})`) };
        }
        // Packed CDRX stores CMX v1 commands, not a ZIP/root.dat object tree.
        async function parseCmx(container, onProgress) {
          const { header, blocks } = container;
          const word = (b, p) => view(b).getUint16(p, true),
            short = (b, p) => view(b).getInt16(p, true);
          if (str(header, 48, 1) !== "2" || str(header, 52, 1) !== "2")
            throw Error("Only little-endian 16-bit CDRX/CMX is supported");
          const unit = word(header, 62),
            factor = d(header, 64),
            mmPerUnit = factor * (unit === 64 ? 25.4 : unit === 35 ? 1 : NaN);
          if (!(mmPerUnit > 0) && Number.isFinite(mmPerUnit)) throw Error("Invalid CDRX unit scale");
          if (!Number.isFinite(mmPerUnit)) throw Error("Unsupported CDRX unit " + unit);
          const warnings = new Map(),
            warn = (s) => warnings.set(s, (warnings.get(s) || 0) + 1),
            tables = new Map(blocks.map((b) => [b.id, b.bytes]));
          const colors = ["none"],
            outlines = [null],
            pens = [null],
            lines = [null],
            dashes = [[]];
          function table(id, read) {
            const b = tables.get(id);
            if (!b) return;
            let p = 2;
            const count = word(b, 0);
            for (let k = 0; k < count; k++) p = read(b, p);
            if (p > b.length) throw Error(id + " table corrupted");
          }
          table("rclr", (b, p) => {
            const model = b[p],
              length = {
                1: 4,
                2: 4,
                3: 4,
                4: 3,
                5: 3,
                6: 4,
                7: 4,
                8: 1,
                9: 1,
                10: 3,
                11: 3,
                12: 3,
              }[model];
            if (!length || p + 2 + length > b.length) throw Error("Unsupported or corrupted CDRX palette");
            const v = Array.from(b.subarray(p + 2, p + 2 + length));
            let rgb;
            if (model === 5) rgb = v;
            else if (model === 2 || model === 3) {
              const den = model === 2 ? 100 : 255;
              rgb = v.slice(0, 3).map((x) => Math.round(255 * (1 - x / den) * (1 - v[3] / den)));
            } else if (model === 4) rgb = v.map((x) => 255 - x);
            else if (model === 8 || model === 9)
              rgb = Array(3).fill(model === 8 ? (v[0] ? 255 : 0) : v[0]);
            else {
              rgb = [0, 0, 0];
              warn("CDRX color model shown as black " + model);
            }
            colors.push("rgb(" + rgb.join(",") + ")");
            return p + 2 + length;
          });
          table("rotl", (b, p) => {
            outlines.push(Array.from({ length: 6 }, (_, k) => word(b, p + 2 * k)));
            return p + 12;
          });
          table("rott", (b, p) => {
            lines.push([b[p], b[p + 1]]);
            return p + 2;
          });
          table("rdot", (b, p) => {
            const count = word(b, p);
            dashes.push(Array.from({ length: count }, (_, k) => word(b, p + 2 + 2 * k)));
            return p + 2 + 2 * count;
          });
          table("rpen", (b, p) => {
            const width = short(b, p),
              type = word(b, p + 8);
            let scale = 1;
            if (type > 1) {
              if (p + 58 > b.length) throw Error("CDRX pen transform out of bounds");
              scale =
                (Math.hypot(d(b, p + 10), d(b, p + 18)) + Math.hypot(d(b, p + 26), d(b, p + 34))) /
                2;
            }
            pens.push(Math.abs(width * scale));
            return p + 10 + (type > 1 ? 48 : 0);
          });
          const pages = [];
          const pageBlocks = blocks.filter((b) => b.id === "page");
          let pageIndex = 0;
          for (const block of pageBlocks) {
            const b = block.bytes,
              parts = [],
              stats = { objects: 0, shapes: 0, texts: 0, skipped: 0 };
            let bounds = null,
              ops = 0;
            for (let p = 0; p + 4 <= b.length;) {
              if (++ops % 500 === 0) await yieldToUI();
              let size = short(b, p),
                head = 4;
              if (size < 0) {
                size = i(b, p + 2);
                head = 8;
              }
              if (size < head || p + size > b.length) throw Error("CDRX instruction out of bounds");
              const op = Math.abs(short(b, p + head - 2)),
                end = p + size;
              let q = p + head;
              if (op === 9) {
                if (q + 22 > end) throw Error("CDRX page record corrupted");
                bounds = Array.from({ length: 4 }, (_, k) => i(b, q + 6 + k * 4));
              } else if (op === 67) {
                stats.objects++;
                const mask = b[q++];
                let fill = "none",
                  stroke = "none",
                  width = 0,
                  cap = "butt",
                  join = "miter",
                  dash = "";
                if (mask & ~3) {
                  stats.skipped++;
                  warn("CDRX special drawing attributes not supported");
                  p = end;
                  continue;
                }
                if (mask & 1) {
                  const type = word(b, q);
                  q += 2;
                  if (type !== 0 && type !== 1) {
                    stats.skipped++;
                    warn("CDRX non-solid fills not supported");
                    p = end;
                    continue;
                  }
                  if (type === 1) {
                    const id = word(b, q);
                    if (!colors[id]) throw Error("Invalid CDRX color reference");
                    fill = colors[id];
                    q += 4;
                  }
                }
                if (mask & 2) {
                  const outline = outlines[word(b, q)];
                  q += 2;
                  if (!outline) throw Error("Invalid CDRX outline reference");
                  const line = lines[outline[0]] || [2, 0];
                  if (!(line[0] & 1)) {
                    stroke = colors[outline[2]] || "black";
                    width = pens[outline[4]] || 0.0762 / mmPerUnit;
                    cap = ["butt", "round", "square"][line[1] & 15] || "butt";
                    join = ["miter", "round", "bevel"][line[1] >> 4] || "miter";
                    const values = (dashes[outline[5]] || []).filter((x) => x > 0);
                    if (values.length)
                      dash = ` stroke-dasharray="${values.map((x) => num(x * width)).join(" ")}"`;
                  }
                }
                const count = word(b, q);
                q += 2;
                if (q + count * 5 > end) throw Error("CDRX curve path truncated");
                const flags = q + count * 4;
                let path = [],
                  controls = [],
                  closed = false,
                  started = false;
                for (let k = 0; k < count; k++) {
                  const xy = `${short(b, q + k * 4)} ${short(b, q + k * 4 + 2)}`,
                    flag = b[flags + k],
                    kind = flag & 192;
                  if (kind === 0) {
                    if (started && closed) path.push("Z");
                    path.push("M " + xy);
                    controls = [];
                    closed = !!(flag & 8);
                    started = true;
                  } else if (kind === 192) controls.push(xy);
                  else {
                    path.push(
                      kind === 128 && controls.length === 2
                        ? "C " + controls.join(" ") + " " + xy
                        : "L " + xy,
                    );
                    controls = [];
                    if (flag & 8) closed = true;
                  }
                }
                if (started && closed) path.push("Z");
                if (path.length) {
                  parts.push(
                    `<path d="${path.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${num(width)}" stroke-linecap="${cap}" stroke-linejoin="${join}"${dash}/>`,
                  );
                  stats.shapes++;
                }
              } else if (![10, 11, 12, 13, 14, 2].includes(op)) {
                stats.skipped++;
                warn("Unsupported CDRX instruction " + op);
              }
              p = end;
            }
            if (!bounds) throw Error("CDRX page missing size");
            const x = Math.min(bounds[0], bounds[2]),
              y = Math.max(bounds[1], bounds[3]),
              w = Math.abs(bounds[2] - bounds[0]),
              h = Math.abs(bounds[3] - bounds[1]);
            if (!w || !h) throw Error("Invalid CDRX page size");
            const width = w * mmPerUnit,
              height = h * mmPerUnit;
            const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${num((width * 300) / 25.4)}px" height="${num((height * 300) / 25.4)}px" viewBox="0 0 ${w} ${h}" fill-rule="evenodd"><g transform="matrix(1 0 0 -1 ${-x} ${y})">${parts.join("\n")}</g></svg>`;
            pages.push({ svg, width, height, stats });
            pageIndex++;
            if (onProgress) onProgress(pageIndex / Math.max(1, pageBlocks.length));
            await yieldToUI();
          }
          if (!pages.length) throw Error("CDRX found no pages");
          return { pages, warnings: [...warnings].map(([s, n]) => `${s} (${n})`) };
        }
        async function unpackCmx(bytes) {
          if (bytes.length < 12 || str(bytes, 8, 4) !== "CDRX")
            throw Error("This RIFF CDR version is not supported yet");
          let header = null,
            blocks = [],
            expanded = 0;
          async function walk(b, start, end, depth = 0) {
            if (depth > 16) throw Error("CDRX nested too deep");
            for (let p = start; p + 8 <= end;) {
              const id = str(b, p, 4),
                length = u(b, p + 4),
                next = p + 8 + length;
              if (next > end) throw Error("CDRX chunk truncated");
              const value = b.subarray(p + 8, next);
              if (id === "cont") header = value;
              else if (id === "pack") {
                if (value.length < 12 || str(value, 4, 4) !== "CPng")
                  throw Error("Unsupported CDRX compression format");
                const expected = u(value, 0);
                expanded += expected;
                if (expanded > 256 * 1024 * 1024) throw Error("CDRX decompressed data exceeds the 256 MB limit");
                async function inflate(packed) {
                  const reader = new Blob([packed])
                      .stream()
                      .pipeThrough(new DecompressionStream("deflate"))
                      .getReader(),
                    chunks = [];
                  let length = 0;
                  for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    length += value.length;
                    if (length > expected) {
                      await reader.cancel();
                      throw Error("Abnormal CDRX decompressed length");
                    }
                    chunks.push(value);
                  }
                  if (length !== expected) throw Error("CDRX decompressed length mismatch");
                  const raw = new Uint8Array(length);
                  let offset = 0;
                  for (const c of chunks) {
                    raw.set(c, offset);
                    offset += c.length;
                  }
                  return raw;
                }
                let raw;
                try {
                  raw = await inflate(value.subarray(12));
                } catch (error) {
                  // CDRX may count one RIFF alignment byte in its compressed payload.
                  // The retry still validates zlib's checksum and the expanded length.
                  if (value[value.length - 1] !== 0) throw error;
                  raw = await inflate(value.subarray(12, -1));
                }
                await walk(raw, 0, raw.length, depth + 1);
              } else if (id === "LIST") {
                if (length < 4) throw Error("CDRX list corrupted");
                await walk(b, p + 12, next, depth + 1);
              } else blocks.push({ id, bytes: value });
              p = next + (length & 1);
            }
          }
          // CDRX RIFF length describes the expanded stream, not the packed file.
          await walk(bytes, 12, bytes.length);
          if (!header || header.length < 72) throw Error("CDRX missing document header");
          return { cmx: { header, blocks } };
        }

        async function bitmapPNG(b) {
          if (b.length < 118 || str(b, 40, 2) !== "RI") return null;
          const model = u(b, 54),
            width = u(b, 62),
            height = u(b, 66),
            bpp = u(b, 74),
            stride = u(b, 78),
            size = u(b, 82);
          if (model !== 1 || bpp !== 24) return null;
          if (
            !width ||
            !height ||
            width * height > 24000000 ||
            stride < width * 3 ||
            size < stride * height ||
            118 + size > b.length
          )
            throw Error("Invalid bitmap dimensions or pixel range");
          const extra = 118 + size;
          let mask = null;
          if (
            extra + 78 <= b.length &&
            str(b, extra, 2) === "RI" &&
            u(b, extra + 14) === 99 &&
            u(b, extra + 22) === width &&
            u(b, extra + 26) === height &&
            u(b, extra + 34) === 8
          ) {
            const row = u(b, extra + 38);
            if (row >= width && extra + 78 + row * height <= b.length)
              mask = { row, start: extra + 78 };
          }
          const channels = mask ? 4 : 3,
            rowBytes = 1 + width * channels,
            raw = new Uint8Array(rowBytes * height);
          for (let y = 0; y < height; y++) {
            const src = 118 + (height - 1 - y) * stride,
              dst = y * rowBytes + 1;
            for (let x = 0; x < width; x++) {
              raw[dst + x * channels] = b[src + x * 3 + 2];
              raw[dst + x * channels + 1] = b[src + x * 3 + 1];
              raw[dst + x * channels + 2] = b[src + x * 3];
              if (mask)
                raw[dst + x * channels + 3] = b[mask.start + (height - 1 - y) * mask.row + x];
            }
          }
          // PNG Sub filtering keeps embedded photographs compact without losing pixels.
          for (let y = 0; y < height; y++) {
            const start = y * rowBytes;
            raw[start] = 1;
            for (let x = width * channels - 1; x >= channels; x--)
              raw[start + 1 + x] = (raw[start + 1 + x] - raw[start + 1 + x - channels]) & 255;
          }
          const compressed = new Uint8Array(
            await new Response(
              new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate")),
            ).arrayBuffer(),
          );
          function chunk(name, data) {
            const block = new Uint8Array(data.length + 12),
              v = view(block);
            v.setUint32(0, data.length);
            for (let k = 0; k < 4; k++) block[4 + k] = name.charCodeAt(k);
            block.set(data, 8);
            v.setUint32(data.length + 8, crc32(block.subarray(4, data.length + 8)));
            return block;
          }
          const header = new Uint8Array(13);
          view(header).setUint32(0, width);
          view(header).setUint32(4, height);
          header[8] = 8;
          header[9] = mask ? 6 : 2;
          const png = new Uint8Array(
            await new Blob([
              new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
              chunk("IHDR", header),
              chunk("IDAT", compressed),
              chunk("IEND", new Uint8Array()),
            ]).arrayBuffer(),
          );
          let binary = "";
          for (let p = 0; p < png.length; p += 32768)
            binary += String.fromCharCode(...png.subarray(p, p + 32768));
          return "data:image/png;base64," + btoa(binary);
        }

        function crc32(bytes) {
          let crc = 0xffffffff;
          for (const b of bytes) {
            crc ^= b;
            for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
          }
          return (crc ^ 0xffffffff) >>> 0;
        }
        const spaceWidths = new Map();
        function fontSpaceWidth(family, size) {
          // Corel tracking/word spacing are relative to the font's space advance.
          if (!spaceWidths.has(family)) {
            let width = 0.5;
            if (typeof document !== "undefined") {
              const canvas = document.createElement("canvas"),
                context = canvas.getContext?.("2d");
              if (context) {
                context.font = "1000px " + JSON.stringify(family);
                width = context.measureText(" ").width / 1000;
              }
            }
            spaceWidths.set(family, width);
          }
          return size * spaceWidths.get(family);
        }
        function fontSegments(text, ch) {
          const out = [];
          for (const char of text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")) {
            const code = char.codePointAt(0),
              script =
                (code >= 0x2e80 && code <= 0x9fff) ||
                (code >= 0xac00 && code <= 0xd7ff) ||
                (code >= 0xf900 && code <= 0xfaff) ||
                (code >= 0xff00 && code <= 0xffef) ||
                (code >= 0x20000 && code <= 0x323af)
                  ? "farEast"
                  : code >= 0x590 && code <= 0x8ff
                    ? "RTL"
                    : "latin";
            const encodedScript =
              script === "latin" &&
              !/[A-Za-z0-9\s]/.test(char) &&
              ["128", "129", "130", "134", "136"].includes(String(ch.latin?.charset))
                ? "farEast"
                : script === "farEast" &&
                    code >= 0xff00 &&
                    code <= 0xffef &&
                    String(ch.farEast?.charset) === "0"
                  ? "latin"
                  : script;
            const preferred = ch[encodedScript] || {},
              fallback = ch.latin || ch.farEast || ch.RTL || {},
              font = { ...fallback, ...preferred };
            const size = Number(font.size) > 0 ? Number(font.size) : 31750,
              key = JSON.stringify([font.font, size, font.italic]);
            if (out.length && out[out.length - 1].key === key) out[out.length - 1].text += char;
            else out.push({ text: char, font, size, key });
          }
          return out.length ? out : [{ text: "", font: {}, size: 31750 }];
        }
        return { unzip, parse, esc, fontSegments };
      })();
export async function parseCdrBytes(
  input: Uint8Array | ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<CdrDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > 150 * 1024 * 1024) throw new Error('CDR file too large (150 MB max)');
  if (!isLikelyCdrBytes(bytes)) throw new Error('Not a CDR file (missing PK/RIFF magic)');
  const files = await CDR.unzip(bytes);
  const doc = await CDR.parse(files, onProgress);
  if (!doc || !Array.isArray((doc as any).pages) || (doc as any).pages.length === 0) {
    throw new Error('No convertible pages found');
  }
  return doc as CdrDocument;
}
