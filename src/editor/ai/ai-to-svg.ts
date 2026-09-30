/**
 * AI/PDF -> SVG parser (pure TypeScript, no dependencies).
 *
 * Illustrator saves .ai files as PDF-compatible documents (the artwork lives
 * in the PDF page content streams; the AI private data is ignored). This
 * module parses a pragmatic PDF subset — classic object layout, Flate/DCT
 * streams, path/text/color/clip/xobject operators — and emits one standalone
 * SVG per page at 96dpi for Paper.js import.
 *
 * Not supported (warned, never fatal): encrypted PDFs, embedded-glyph fonts
 * (text is approximated from ToUnicode/latin1), sampled (type 0) shadings,
 * pattern tiling, PostScript-style .ai (EPS) files are refused with a hint.
 * Operator research: real Illustrator production files + PDF 1.6 reference.
 */
// @ts-nocheck

export interface AiPageStats {
  shapes?: number;
  texts?: number;
  images?: number;
  clips?: number;
  skipped?: number;
}
export interface AiPage {
  svg: string;
  width: number;
  height: number;
  stats: AiPageStats;
}
export interface AiDocument {
  pages: AiPage[];
  warnings: string[];
}

/** Document output units are CSS px at 96dpi; PDF user space is 72dpi. */
export const AI_PT_TO_PX = 96 / 72;

/** Quick magic check: PDF-compatible .ai / plain PDF (not EPS). */
export function isLikelyAiBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 5) return false;
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  if (head.startsWith('%PDF')) return true;
  // Old PostScript-style .ai: recognized but rejected by the parser with a
  // conversion hint, so the caller can distinguish it from garbage.
  if (head.startsWith('%!PS')) return true;
  return false;
}

const AI = (() => {
  const latin = new TextDecoder('latin1');
  const num = (n) => {
    if (!Number.isFinite(n)) throw Error('Invalid numeric coordinate');
    return String(Math.round(n * 10000) / 10000);
  };
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
    );
  // Local copy of the UI yield (kept in sync with src/editor/busy.ts):
  // this module stays import-free so it also runs under plain Node.
  const abortError = () => {
    const e = new Error('Operation cancelled');
    e.name = 'AbortError';
    return e;
  };
  // The yield doubles as a cancellation checkpoint, matching cdr-to-svg.ts.
  const yieldToUI = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      // An `abort` listener, not a polling watchdog: the frame callback wins
      // the race in practice, so a poll would miss cancellations that arrive
      // mid-yield.
      const detach = () => {
        if (signal) signal.removeEventListener('abort', abort);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        detach();
        resolve();
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        detach();
        reject(abortError());
      };
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const timer = setTimeout(finish, 32);
      if (signal) signal.addEventListener('abort', abort, { once: true });
      if (typeof requestAnimationFrame === 'function')
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
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

  // ---------------------------------------------------------------- lexer

  function ws(b: number): boolean {
    return b === 0 || b === 9 || b === 10 || b === 12 || b === 13 || b === 32;
  }
  const isDigit = (b) => b >= 48 && b <= 57;

  /**
   * Cursor-based PDF value reader. Values:
   * numbers, `name` (string, slash stripped), strings (latin1, escapes
   * resolved), {hex: true, bytes} hex strings, arrays, dicts (plain object
   * keyed by name), refs {ref: n}, true/false/null.
   */
  class Lexer {
    b: Uint8Array;
    p = 0;
    end: number;
    constructor(b: Uint8Array, p = 0, end = b.length) {
      this.b = b;
      this.p = p;
      this.end = end;
    }
    skipWs(): void {
      while (this.p < this.end && ws(this.b[this.p])) this.p++;
    }
    skipComment(): void {
      while (this.p < this.end && this.b[this.p] !== 10 && this.b[this.p] !== 13) this.p++;
    }
    token(): string {
      this.skipWs();
      let s = '';
      while (this.p < this.end && !ws(this.b[this.p])) {
        const c = this.b[this.p];
        if (
          c === 47 /* / */ ||
          c === 60 /* < */ ||
          c === 62 /* > */ ||
          c === 40 /* ( */ ||
          c === 91 /* [ */ ||
          c === 93 /* ] */ ||
          c === 123 /* { */ ||
          c === 125 /* } */ ||
          c === 37 /* % */ ||
          c === 41 /* ) */ ||
          c === 60
        )
          break;
        s += String.fromCharCode(c);
        this.p++;
      }
      return s;
    }
    value(): any {
      this.skipWs();
      while (this.b[this.p] === 37 /* % */) {
        this.skipComment();
        this.skipWs();
      }
      if (this.p >= this.end) return null;
      const c = this.b[this.p];
      if (c === 47 /* / */) {
        this.p++;
        let s = '';
        while (this.p < this.end) {
          const d = this.b[this.p];
          if (ws(d) || d === 47 || d === 60 || d === 62 || d === 40 || d === 41 || d === 91 || d === 93 || d === 123 || d === 125 || d === 37)
            break;
          s += String.fromCharCode(d);
          this.p++;
        }
        return s;
      }
      if (c === 40 /* ( */) return this.literalString();
      if (c === 60 && this.b[this.p + 1] === 60 /* << */) return this.dict();
      if (c === 60 /* < */) return this.hexString();
      if (c === 91 /* [ */) return this.array();
      if (c === 43 || c === 45 || c === 46 || isDigit(c)) {
        const num = this.number();
        // "N G R" indirect reference lookahead (only numbers start refs).
        const after = this.p;
        this.skipWs();
        if (isDigit(this.b[this.p])) {
          const gen = this.token();
          if (/^\d+$/.test(gen)) {
            this.skipWs();
            if (this.b[this.p] === 82 /* R */) {
              this.p++;
              return { ref: num };
            }
          }
        }
        this.p = after;
        return num;
      }
      const tok = this.token();
      if (tok === 'true') return true;
      if (tok === 'false') return false;
      if (tok === 'null') return null;
      return tok;
    }
    number(): number {
      let s = '';
      while (this.p < this.end) {
        const c = this.b[this.p];
        if (!isDigit(c) && c !== 43 && c !== 45 && c !== 46) break;
        s += String.fromCharCode(c);
        this.p++;
      }
      return parseFloat(s) || 0;
    }
    literalString(): string {
      // ( ... ) with nesting and escapes; returns latin1 text.
      this.p++; // (
      let depth = 1;
      let s = '';
      while (this.p < this.end && depth > 0) {
        const c = this.b[this.p];
        if (c === 92 /* \ */) {
          this.p++;
          const e = this.b[this.p];
          if (e === 110) { s += '\n'; this.p++; }
          else if (e === 114) { s += '\r'; this.p++; }
          else if (e === 116) { s += '\t'; this.p++; }
          else if (e === 98) { s += '\b'; this.p++; }
          else if (e === 102) { s += '\f'; this.p++; }
          else if (e >= 48 && e <= 55) {
            // up to 3 octal digits
            let v = 0, n = 0;
            while (n < 3 && this.p < this.end && this.b[this.p] >= 48 && this.b[this.p] <= 55) {
              v = v * 8 + (this.b[this.p] - 48);
              this.p++;
              n++;
            }
            s += String.fromCharCode(v & 0xff);
          } else if (e === 13) {
            this.p++;
            if (this.b[this.p] === 10) this.p++;
          } else { s += String.fromCharCode(e); this.p++; }
          continue;
        }
        if (c === 40 /* ( */) depth++;
        if (c === 41 /* ) */) {
          depth--;
          if (depth === 0) { this.p++; break; }
        }
        s += String.fromCharCode(c);
        this.p++;
      }
      return s;
    }
    hexString(): { hex: boolean; text: string } {
      this.p++; // <
      let s = '';
      while (this.p < this.end && this.b[this.p] !== 62 /* > */) {
        const c = this.b[this.p];
        if (!ws(c)) s += String.fromCharCode(c);
        this.p++;
      }
      this.p++; // >
      if (s.length % 2) s += '0';
      let out = '';
      for (let k = 0; k < s.length; k += 2) out += String.fromCharCode(parseInt(s.slice(k, k + 2), 16));
      return { hex: true, text: out };
    }
    array(): any[] {
      this.p++; // [
      const out = [];
      for (;;) {
        this.skipWs();
        if (this.p >= this.end) break;
        if (this.b[this.p] === 93 /* ] */) { this.p++; break; }
        out.push(this.value());
      }
      return out;
    }
    dict(): Record<string, any> {
      this.p += 2; // <<
      const out = {};
      for (;;) {
        this.skipWs();
        if (this.p >= this.end) break;
        if (this.b[this.p] === 62 && this.b[this.p + 1] === 62 /* >> */) { this.p += 2; break; }
        if (this.b[this.p] !== 47 /* / */) { this.p++; continue; }
        const key = this.value();
        const val = this.value();
        out[key] = val;
      }
      return out;
    }
  }

  // ------------------------------------------------------- object access

  function scanObjects(b: Uint8Array): Map<number, number> {
    const map = new Map();
    const text = latin.decode(b);
    const re = /(\d+)\s+0\s+obj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (!map.has(n)) map.set(n, m.index + m[0].length);
    }
    return map;
  }

  /**
   * Read one object body at its offset. Always returns { dict, __stream? }
   * where dict is the parsed value (plain dict for most objects).
   */
  function readObject(b: Uint8Array, objects: Map<number, number>, num: number): any {
    const off = objects.get(num);
    if (off === undefined) return null;
    const lx = new Lexer(b, off);
    lx.skipWs();
    const dict = lx.value();
    if (dict === null || dict === undefined) return null;
    if (typeof dict !== 'object' || Array.isArray(dict) || dict.ref !== undefined) {
      return { dict };
    }
    lx.skipWs();
    if (b[lx.p] === 115 /* s */ && latin.decode(b.subarray(lx.p, lx.p + 6)).startsWith('stream')) {
      lx.p += 6;
      // stream keyword: one CRLF / LF / CR
      if (b[lx.p] === 13) lx.p++;
      if (b[lx.p] === 10) lx.p++;
      let end = -1;
      const direct = Number(dict.Length);
      if (Number.isFinite(direct) && direct >= 0) {
        const probe = latin.decode(b.subarray(lx.p + direct, lx.p + direct + 16));
        if (probe.startsWith('endstream')) end = lx.p + direct;
      }
      if (end < 0) {
        const from = lx.p;
        const rel = latin.decode(b.subarray(from, from + (b.length - from))).indexOf('endstream');
        if (rel >= 0) end = from + rel;
        else end = b.length;
      }
      const stream = b.subarray(lx.p, end);
      return { __stream: stream, dict };
    }
    return { dict };
  }

  function deref(b: Uint8Array, objects: Map<number, number>, v: any, depth = 0): any {
    if (v && typeof v === 'object' && v.ref !== undefined && depth < 8) {
      const o = readObject(b, objects, v.ref);
      if (o && typeof o === 'object' && o.dict !== undefined) return deref(b, objects, o.dict, depth + 1);
      return o;
    }
    return v;
  }

  async function flate(data: Uint8Array, warn: (s: string) => void): Promise<Uint8Array | null> {
    if (typeof DecompressionStream === 'undefined') {
      warn('Local decompression is not supported by this browser, please use a recent Chrome or Edge');
      return null;
    }
    try {
      const reader = new Blob([data.slice()])
        .stream()
        .pipeThrough(new DecompressionStream('deflate'))
        .getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        got += value.length;
        if (got > 256 * 1024 * 1024) {
          await reader.cancel();
          throw Error('Decompressed data exceeds the 256 MB limit');
        }
        chunks.push(value);
      }
      const out = new Uint8Array(got);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    } catch {
      // PDF streams often carry trailing bytes; shrink until the zlib stream
      // ends (bounded: real tails are a few bytes, big misses are corruption).
      const floor = Math.max(16, data.length - 16);
      for (let cut = data.length - 1; cut >= floor; cut--) {
        try {
          const reader = new Blob([data.slice(0, cut)])
            .stream()
            .pipeThrough(new DecompressionStream('deflate'))
            .getReader();
          const chunks = [];
          let got = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
            got += value.length;
          }
          const out = new Uint8Array(got);
          let at = 0;
          for (const c of chunks) {
            out.set(c, at);
            at += c.length;
          }
          return out;
        } catch {
          /* keep shrinking */
        }
      }
      warn('Corrupt compressed stream');
      return null;
    }
  }

  /** Decode PDF literal-string escapes (the raw inner text). */
  function decodePdfString(raw: string): string {
    let s = '';
    let p = 0;
    while (p < raw.length) {
      const ch = raw[p];
      if (ch === '\\') {
        p++;
        const e = raw[p];
        if (e === 'n') { s += '\n'; p++; }
        else if (e === 'r') { s += '\r'; p++; }
        else if (e === 't') { s += '\t'; p++; }
        else if (e === 'b') { s += '\b'; p++; }
        else if (e === 'f') { s += '\f'; p++; }
        else if (e >= '0' && e <= '7') {
          let v = 0;
          let k = 0;
          while (k < 3 && p < raw.length && raw[p] >= '0' && raw[p] <= '7') {
            v = v * 8 + (raw.charCodeAt(p) - 48);
            p++;
            k++;
          }
          s += String.fromCharCode(v & 0xff);
        } else if (e === '\r') {
          p++;
          if (raw[p] === '\n') p++;
        } else {
          s += e;
          p++;
        }
        continue;
      }
      s += ch;
      p++;
    }
    return s;
  }
  function hexText(s: string): string {
    const hex = s.replace(/[^0-9a-fA-F]/g, '');
    let out = '';
    for (let k = 0; k < hex.length; k += 2) {
      const chunk = hex.slice(k, k + 2).padEnd(2, '0');
      out += String.fromCharCode(parseInt(chunk, 16));
    }
    return out;
  }

  // ------------------------------------------------------------ colors

  /** CMYK (0-1) to naive rgb() like the CDR path's color model. */
  function cmykToRgb(c, m, y, k): string {
    const f = (x) => Math.max(0, Math.min(255, Math.round(255 * (1 - x) * (1 - k))));
    return `rgb(${f(c)},${f(m)},${f(y)})`;
  }
  function compsToRgb(comps, kind): string {
    const v = comps.map((x) => Math.max(0, Math.min(1, Number(x) || 0)));
    if (kind === 'gray') {
      const g = Math.round(v[0] * 255);
      return `rgb(${g},${g},${g})`;
    }
    if (kind === 'cmyk') return cmykToRgb(v[0], v[1], v[2], v[3]);
    const f = (x) => Math.round(v[x] * 255);
    return `rgb(${f(0)},${f(1)},${f(2)})`;
  }
  /** Classify a colorspace value into { kind, base?, lookup?, hival? }. */
  function colorspaceInfo(b, objects, cs): any {
    if (cs === 'DeviceGray' || cs === 'CalGray') return { kind: 'gray' };
    if (cs === 'DeviceRGB' || cs === 'CalRGB') return { kind: 'rgb' };
    if (cs === 'DeviceCMYK' || cs === 'CalCMYK') return { kind: 'cmyk' };
    if (cs === 'Pattern') return { kind: 'pattern' };
    if (Array.isArray(cs) && cs[0] === 'ICCBased') {
      const stream = deref(b, objects, cs[1]);
      const n = Number(stream?.N) || 3;
      return { kind: n === 1 ? 'gray' : n === 4 ? 'cmyk' : 'rgb' };
    }
    if (Array.isArray(cs) && cs[0] === 'Indexed') {
      const base = colorspaceInfo(b, objects, cs[1]);
      const lookup = cs[3];
      return {
        kind: 'indexed',
        base,
        hival: Number(cs[2]) || 0,
        lookup: typeof lookup === 'string' ? lookup : '',
      };
    }
    if (Array.isArray(cs) && (cs[0] === 'Separation' || cs[0] === 'DeviceN')) {
      return { kind: 'separation' };
    }
    return { kind: 'rgb' };
  }
  /** Apply sc/scn operands under the given colorspace. */
  function colorFrom(colorspace: any, operands: any[]): string | { pattern: string } {
    if (colorspace.kind === 'pattern') {
      const name = operands.find((o) => o && o.name);
      return { pattern: name ? name.name : '' };
    }
    if (colorspace.kind === 'indexed') {
      const i = Math.max(0, Math.min(colorspace.hival, Math.round(Number(operands[0]) || 0)));
      const n = colorspace.base?.kind === 'cmyk' ? 4 : colorspace.base?.kind === 'gray' ? 1 : 3;
      const off = i * n;
      const bytes = colorspace.lookup || '';
      if (off + n > bytes.length) return '#000000';
      const take = (k) => bytes.charCodeAt(off + k) / 255;
      if (n === 1) return compsToRgb([take(0)], 'gray');
      if (n === 4) return cmykToRgb(take(0), take(1), take(2), take(3));
      return compsToRgb([take(0), take(1), take(2)], 'rgb');
    }
    if (colorspace.kind === 'separation') {
      // No tint transform: approximate by the gray level of the tint.
      return compsToRgb([Number(operands[0]) || 0], 'gray');
    }
    return compsToRgb(operands, colorspace.kind);
  }

  // ------------------------------------------------------ graphics state

  function newState(ctm): any {
    return {
      ctm,
      fill: '#000000',
      stroke: '#000000',
      fillCs: { kind: 'gray' },
      strokeCs: { kind: 'gray' },
      fillPat: null,
      strokePat: null,
      fillA: 1,
      strokeA: 1,
      lw: 1,
      dash: null,
      cap: 0,
      join: 0,
      miter: 10,
      font: '',
      fontSize: 12,
      tm: null,
      tlm: null,
      leading: 0,
      pendingClip: null,
      clips: [],
      openGroups: 0,
    };
  }

  function pathD(path: any[], ctm): string {
    if (!path.length) return '';
    const t = (x, y) => {
      const px = ctm[0] * x + ctm[2] * y + ctm[4];
      const py = ctm[1] * x + ctm[3] * y + ctm[5];
      return [num(px), num(py)];
    };
    let d = '';
    for (const seg of path) {
      if (seg.t === 'M') {
        const [x, y] = t(seg.x, seg.y);
        d += `M ${x} ${y} `;
      } else if (seg.t === 'L') {
        const [x, y] = t(seg.x, seg.y);
        d += `L ${x} ${y} `;
      } else if (seg.t === 'C') {
        const [x1, y1] = t(seg.x1, seg.y1);
        const [x2, y2] = t(seg.x2, seg.y2);
        const [x, y] = t(seg.x, seg.y);
        d += `C ${x1} ${y1} ${x2} ${y2} ${x} ${y} `;
      } else if (seg.t === 'Z') d += 'Z ';
    }
    return d.trim();
  }
  function pathBBox(path: any[], ctm): number[] {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    const acc = (x, y) => {
      const px = ctm[0] * x + ctm[2] * y + ctm[4];
      const py = ctm[1] * x + ctm[3] * y + ctm[5];
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    };
    for (const seg of path) {
      if (seg.t === 'C') {
        acc(seg.x1, seg.y1);
        acc(seg.x2, seg.y2);
        acc(seg.x, seg.y);
      } else if (seg.t !== 'Z') acc(seg.x, seg.y);
    }
    if (!Number.isFinite(x0)) return [0, 0, 0, 0];
    return [x0, y0, x1, y1];
  }

  /** Sample a PDF function into SVG gradient stops. */
  function shadingStops(fn: any): string {
    if (!fn) return '';
    const colorCss = (comps: any[]): string => {
      const v = comps.map((x) => Math.max(0, Math.min(1, Number(x) || 0)));
      if (v.length === 1) {
        const g = Math.round(v[0] * 255);
        return `rgb(${g},${g},${g})`;
      }
      if (v.length >= 3) {
        const f = (x) => Math.round(v[x] * 255);
        return `rgb(${f(0)},${f(1)},${f(2)})`;
      }
      return '#000000';
    };
    const type = Number(fn.FunctionType);
    if (type === 2) {
      const c0 = Array.isArray(fn.C0) ? fn.C0 : [0];
      const c1 = Array.isArray(fn.C1) ? fn.C1 : [1];
      const nExp = Number(fn.N) || 1;
      const stops = [`<stop offset="0" stop-color="${colorCss(c0)}"/>`];
      if (nExp !== 1) {
        const mid = c0.map((x, k) => {
          const a = Number(x) || 0;
          const c = Number(c1[k]) || 0;
          return a + (c - a) * Math.pow(0.5, nExp);
        });
        stops.push(`<stop offset="0.5" stop-color="${colorCss(mid)}"/>`);
      }
      stops.push(`<stop offset="1" stop-color="${colorCss(c1)}"/>`);
      return stops.join('');
    }
    if (type === 3) {
      const fns = fn.Functions ?? [];
      const bounds = (fn.Bounds ?? []).map(Number);
      const encode = (fn.Encode ?? []).map(Number);
      const edges = [0, ...bounds, 1];
      const stops: string[] = [];
      const sample = (f: any, u: number): any[] => {
        if (Number(f?.FunctionType) === 2) {
          const c0 = Array.isArray(f.C0) ? f.C0 : [0];
          const c1 = Array.isArray(f.C1) ? f.C1 : [1];
          const e = Math.pow(u, Number(f.N) || 1);
          return c0.map((x: number, k: number) => (Number(x) || 0) + ((Number(c1[k]) || 0) - (Number(x) || 0)) * e);
        }
        return [0, 0, 0];
      };
      for (let s = 0; s < fns.length; s++) {
        const e0 = encode[s * 2] ?? 0;
        const e1 = encode[s * 2 + 1] ?? 1;
        const a = edges[s];
        const bEdge = edges[s + 1];
        stops.push(`<stop offset="${num(a)}" stop-color="${colorCss(sample(fns[s], Math.max(0, Math.min(1, e0))))}"/>`);
        stops.push(`<stop offset="${num(bEdge)}" stop-color="${colorCss(sample(fns[s], Math.max(0, Math.min(1, e1))))}"/>`);
      }
      return stops.join('');
    }
    return '';
  }

  /** Build a gradient def for an axial/radial shading; returns def id or ''. */
  function shadingDef(b: Uint8Array, objects: Map<number, number>, ctx: any, st: any, sh: any): string {
    const type = Number(sh.ShadingType);
    const coords = (sh.Coords ?? []).map(Number);
    const ctm = st.ctm;
    const fn = deref(b, objects, sh.Function);
    const stops = shadingStops(fn);
    if (!stops.length) {
      ctx.warn('Unsupported shading function');
      return '';
    }
    ctx.shadeN++;
    const id = `sh-${ctx.shadeN}`;
    const pt = (x, y) => {
      const px = ctm[0] * x + ctm[2] * y + ctm[4];
      const py = ctm[1] * x + ctm[3] * y + ctm[5];
      return [num(px), num(py)];
    };
    const scale = scaleOf(ctm);
    if (type === 2) {
      const [x0, y0, x1, y1] = coords;
      const [ax, ay] = pt(x0, y0);
      const [bx, by] = pt(x1, y1);
      ctx.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}">${stops}</linearGradient>`,
      );
    } else if (type === 3) {
      const [x0, y0, r0, x1, y1, r1] = coords;
      const [cx, cy] = pt(x1, y1);
      const [fx, fy] = pt(x0, y0);
      ctx.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${num(Math.abs(r1) * scale)}" fx="${fx}" fy="${fy}">${stops}</radialGradient>`,
      );
    } else {
      ctx.warn('Unsupported shading type ' + type);
      return '';
    }
    return id;
  }

  async function emitShading(b: Uint8Array, objects: Map<number, number>, ctx: any, st: any, sh: any): Promise<void> {
    const id = shadingDef(b, objects, ctx, st, sh);
    if (!id) {
      ctx.stats.skipped++;
      return;
    }
    const box = ctx.clipBoxes[ctx.clipBoxes.length - 1] ?? ctx.pageBox;
    const x = box[0];
    const y = box[1];
    ctx.body.push(
      `<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(1, box[2] - x))}" height="${num(Math.max(1, box[3] - y))}" fill="url(#${id})"/>`,
    );
    ctx.stats.shapes++;
  }

  // ----------------------------------------------------- PNG encoding

  let crcTable: Uint32Array | null = null;
  function crc32(data: Uint8Array, from = 0, to = data.length): number {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let k = from; k < to; k++) crc = (crcTable[(crc ^ data[k]) & 0xff] ^ (crc >>> 8)) >>> 0;
    return (crc ^ 0xffffffff) >>> 0;
  }
  function adler32(data: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (let k = 0; k < data.length; k++) {
      a = (a + data[k]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }
  function u32b(n: number): Uint8Array {
    return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  }
  function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const len = u32b(data.length);
    const typeBytes = new Uint8Array(Array.from(type).map((c) => c.charCodeAt(0)));
    const body = new Uint8Array(typeBytes.length + data.length);
    body.set(typeBytes);
    body.set(data, typeBytes.length);
    const crc = u32b(crc32(body));
    const out = new Uint8Array(len.length + body.length + crc.length);
    out.set(len);
    out.set(body, len.length);
    out.set(crc, len.length + body.length);
    return out;
  }
  /** Minimal PNG encoder: stored (uncompressed) deflate blocks. */
  function buildPng(width: number, height: number, gray: boolean, pixels: Uint8Array): Uint8Array {
    const bpp = gray ? 1 : 3;
    const stride = width * bpp;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 0;
      raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const blocks = Math.ceil(raw.length / 65535);
    const idat = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    let at = 0;
    idat[at++] = 0x78;
    idat[at++] = 0x01;
    let off = 0;
    while (off < raw.length) {
      const block = Math.min(65535, raw.length - off);
      const final = off + block >= raw.length ? 1 : 0;
      idat[at++] = final;
      idat[at++] = block & 255;
      idat[at++] = (block >> 8) & 255;
      idat[at++] = ~block & 255;
      idat[at++] = (~block >> 8) & 255;
      idat.set(raw.subarray(off, off + block), at);
      at += block;
      off += block;
    }
    idat.set(u32b(adler32(raw)), at);
    at += 4;
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, width);
    new DataView(ihdr.buffer).setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = gray ? 0 : 2;
    const ihdrChunk = pngChunk('IHDR', ihdr);
    const idatChunk = pngChunk('IDAT', idat.subarray(0, at));
    const iend = pngChunk('IEND', new Uint8Array(0));
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const out = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iend.length);
    out.set(sig);
    out.set(ihdrChunk, sig.length);
    out.set(idatChunk, sig.length + ihdrChunk.length);
    out.set(iend, sig.length + ihdrChunk.length + idatChunk.length);
    return out;
  }

  function base64(data: Uint8Array): string {
    let s = '';
    for (let k = 0; k < data.length; k += 0x8000) {
      s += String.fromCharCode.apply(null, Array.from(data.subarray(k, k + 0x8000)) as unknown as number[]);
    }
    return btoa(s);
  }

  async function emitImage(
    ctx: any,
    st: any,
    b: Uint8Array,
    objects: Map<number, number>,
    objNum: number
  ): Promise<void> {
    const xobj = readObject(b, objects, objNum);
    const dict = xobj && xobj.dict ? xobj.dict : null;
    if (!dict || !xobj.__stream) {
      ctx.stats.skipped++;
      return;
    }
    const width = Number(dict.Width) || 0;
    const height = Number(dict.Height) || 0;
    if (!width || !height || width * height > 64e6) {
      ctx.warn('Unsupported image size');
      ctx.stats.skipped++;
      return;
    }
    const filters = (Array.isArray(dict.Filter) ? dict.Filter : dict.Filter ? [dict.Filter] : []).map(
      (f: any) => deref(b, objects, f)
    );
    const isDct = filters.includes('DCTDecode') || filters.includes('DCT');
    let raw: Uint8Array | null = xobj.__stream;
    if (filters.some((f) => f !== 'DCTDecode' && f !== 'DCT')) {
      // strip the non-DCT filters (typically FlateDecode) off the bytes
      const filters2 = filters.filter((f) => f !== 'DCTDecode' && f !== 'DCT');
      let data: Uint8Array = xobj.__stream;
      let ok = true;
      for (const f of filters2) {
        if (f === 'FlateDecode') {
          data = await flate(data, ctx.warn);
          if (!data) { ok = false; break; }
        } else {
          ctx.warn('Unsupported image filter ' + f);
          ok = false;
          break;
        }
      }
      if (!ok) {
        ctx.stats.skipped++;
        return;
      }
      raw = data;
    } else {
      raw = xobj.__stream;
    }
    let href = '';
    if (isDct) {
      href = `data:image/jpeg;base64,${base64(raw)}`;
    } else {
      const csRaw = Array.isArray(dict.ColorSpace) ? dict.ColorSpace[0] : dict.ColorSpace;
      const bpc = Number(dict.BitsPerComponent) || 8;
      if (bpc !== 8) {
        ctx.warn('Unsupported image bit depth ' + bpc);
        ctx.stats.skipped++;
        return;
      }
      let kind = csRaw === 'DeviceGray' ? 'gray' : csRaw === 'DeviceCMYK' ? 'cmyk' : 'rgb';
      if (csRaw && typeof csRaw === 'object') {
        // [/Indexed base hival lookup]
        if (csRaw[0] === 'Indexed') {
          const base = colorspaceInfo(b, objects, csRaw[1]);
          const n = base.kind === 'cmyk' ? 4 : base.kind === 'gray' ? 1 : 3;
          const lookup = typeof csRaw[3] === 'string' ? csRaw[3] : '';
          const rgb = new Uint8Array(width * height * 3);
          for (let k = 0; k < width * height; k++) {
            const i = Math.max(0, Math.min(Number(csRaw[2]) || 0, raw[k]));
            const off2 = i * n;
            if (n === 1) {
              const g = lookup.charCodeAt(off2) & 255;
              rgb[k * 3] = g;
              rgb[k * 3 + 1] = g;
              rgb[k * 3 + 2] = g;
            } else if (n === 3) {
              rgb[k * 3] = lookup.charCodeAt(off2) & 255;
              rgb[k * 3 + 1] = lookup.charCodeAt(off2 + 1) & 255;
              rgb[k * 3 + 2] = lookup.charCodeAt(off2 + 2) & 255;
            } else {
              const conv = cmykToRgb(
                (lookup.charCodeAt(off2) & 255) / 255,
                (lookup.charCodeAt(off2 + 1) & 255) / 255,
                (lookup.charCodeAt(off2 + 2) & 255) / 255,
                (lookup.charCodeAt(off2 + 3) & 255) / 255,
              );
              const parts = conv.match(/\d+/g) ?? ['0', '0', '0'];
              rgb[k * 3] = Number(parts[0]);
              rgb[k * 3 + 1] = Number(parts[1]);
              rgb[k * 3 + 2] = Number(parts[2]);
            }
          }
          const png = buildPng(width, height, false, rgb);
          href = `data:image/png;base64,${base64(png)}`;
          kind = 'done';
        } else if (csRaw[0] === 'ICCBased') {
          const stream = deref(b, objects, csRaw[1]);
          const n = Number(stream?.N) || 3;
          kind = n === 1 ? 'gray' : n === 4 ? 'cmyk' : 'rgb';
        }
      }
      if (kind !== 'done') {
        if (kind === 'cmyk') {
          ctx.warn('CMYK images not supported');
          ctx.stats.skipped++;
          return;
        }
        const need = width * height * (kind === 'gray' ? 1 : 3);
        if (raw.length < need) {
          ctx.warn('Truncated image data');
          ctx.stats.skipped++;
          return;
        }
        const png = buildPng(width, height, kind === 'gray', raw.subarray(0, need));
        href = `data:image/png;base64,${base64(png)}`;
      }
    }
    if (!href) {
      ctx.stats.skipped++;
      return;
    }
    // Image unit square: (0,0) is the TOP-left corner; flip into the y-up
    // page space, then bake the CTM.
    ctx.body.push(
      `<g transform="matrix(${st.ctm.map(num).join(' ')})"><image x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="matrix(1 0 0 -1 0 1)" href="${href}"/></g>`,
    );
    ctx.stats.images++;
  }

  // ------------------------------------------------ content interpreter

  /**
   * Interpret one content stream (page or form) into SVG body fragments.
   * Coordinates are baked through the CTM into PDF page space; the page
   * wrapper applies the single y-flip.
   */
  async function interpret(
    b: Uint8Array,
    objects: Map<number, number>,
    data: Uint8Array,
    resources: any,
    ctx: any,
    st: any,
    depth: number
  ): Promise<void> {
    if (!data || !data.length || depth > 12) return;
    const bodyText = latin.decode(data);
    const n = bodyText.length;
    const isDig = (c: string) => c >= '0' && c <= '9';
    const ops: Array<{ op: string; args: any[] }> = [];
    {
      let p = 0;
      while (p < n) {
        const c = bodyText[p];
        if (c === '%') {
          while (p < n && bodyText[p] !== '\n' && bodyText[p] !== '\r') p++;
          continue;
        }
        if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '\f' || c === '\0') {
          p++;
          continue;
        }
        if (c === '/') {
          let s = '';
          p++;
          while (p < n && !/[\s/[\]<>{}()%]/.test(bodyText[p])) {
            s += bodyText[p];
            p++;
          }
          ops.push({ op: 'NAME', args: [s] });
          continue;
        }
        if (c === '(') {
          let s = '';
          let d = 1;
          p++;
          while (p < n && d > 0) {
            const ch = bodyText[p];
            if (ch === '\\') {
              p++;
              const e = bodyText[p];
              if (e === 'n') { s += '\n'; p++; }
              else if (e === 'r') { s += '\r'; p++; }
              else if (e === 't') { s += '\t'; p++; }
              else if (e === 'b') { s += '\b'; p++; }
              else if (e === 'f') { s += '\f'; p++; }
              else if (e >= '0' && e <= '7') {
                let v = 0;
                let k = 0;
                while (k < 3 && p < n && bodyText[p] >= '0' && bodyText[p] <= '7') {
                  v = v * 8 + (bodyText.charCodeAt(p) - 48);
                  p++;
                  k++;
                }
                s += String.fromCharCode(v & 0xff);
              } else if (e === '\r') {
                p++;
                if (bodyText[p] === '\n') p++;
              } else {
                s += e;
                p++;
              }
              continue;
            }
            if (ch === '(') d++;
            if (ch === ')') {
              d--;
              if (d === 0) {
                p++;
                break;
              }
            }
            s += ch;
            p++;
          }
          ops.push({ op: 'STR', args: [s] });
          continue;
        }
        if (c === '<' && bodyText[p + 1] === '<') {
          const sub = latin.encode(bodyText.slice(p));
          const lx2 = new Lexer(sub, 0, sub.length);
          const d = lx2.dict();
          p += lx2.p;
          ops.push({ op: 'DICT', args: [d] });
          continue;
        }
        if (c === '<') {
          let s = '';
          p++;
          while (p < n && bodyText[p] !== '>') {
            const ch = bodyText[p];
            if (ch !== '\n' && ch !== '\r' && ch !== ' ' && ch !== '\t') s += ch;
            p++;
          }
          p++;
          if (s.length % 2) s += '0';
          let out = '';
          for (let k = 0; k < s.length; k += 2) out += String.fromCharCode(parseInt(s.slice(k, k + 2), 16));
          ops.push({ op: 'STR', args: [out] });
          continue;
        }
        if (c === ']') {
          p++;
          continue;
        }
        if (c === '[') {
          // array operand: scan to the matching bracket, keep raw pieces
          let d = 1;
          let s = '';
          p++;
          while (p < n && d > 0) {
            const ch = bodyText[p];
            if (ch === '[') d++;
            if (ch === ']') {
              d--;
              if (d === 0) {
                p++;
                break;
              }
            }
            s += ch;
            p++;
          }
          const inner = s.match(/-?[\d.]+|\/[^\s[\]]+|\((?:\\.|[^)\\])*\)|<[^>]*>/g) ?? [];
          const arr = inner.map((t) =>
            t.startsWith('/')
              ? { name: t.slice(1) }
              : isDig(t[0]) || (t[0] === '-' && isDig(t[1])) || t[0] === '.'
                ? parseFloat(t)
                : typeof t === 'string' && t.startsWith('(')
                  ? decodePdfString(t.slice(1, -1))
                  : typeof t === 'string' && t.startsWith('<')
                    ? hexText(t.slice(1, -1))
                    : t,
          );
          ops.push({ op: 'ARR', args: [arr] });
          continue;
        }
        if (isDig(c) || ((c === '-' || c === '+' || c === '.') && isDig(bodyText[p + 1]))) {
          let s = '';
          while (p < n && /[-+.\d]/.test(bodyText[p])) {
            s += bodyText[p];
            p++;
          }
          ops.push({ op: 'NUM', args: [parseFloat(s)] });
          continue;
        }
        if (/[A-Za-z'"*@]/.test(c)) {
          let s = '';
          while (p < n && /[A-Za-z0-9'"*+#.-]/.test(bodyText[p])) {
            s += bodyText[p];
            p++;
          }
          ops.push({ op: s, args: [] });
          continue;
        }
        p++;
      }
    }
    let unknown = 0;
    let done = 0;
    const total = ops.length;
    const path: any[] = [];
    let cur: number[] | null = null;
    let pendingClipRule: string | null = null;
    const operands: any[] = [];
    const fillPaint = () => (st.fillPat ? `url(#${st.fillPat})` : st.fill);
    const strokePaint = () => (st.strokePat ? `url(#${st.strokePat})` : st.stroke);

    const applyClip = (rule: string): void => {
      const d = pathD(path, st.ctm);
      if (!d) return;
      ctx.clipN++;
      const id = `clip-${ctx.clipN}`;
      ctx.defs.push(
        `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${d}"${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`,
      );
      st.clips.push(id);
      ctx.body.push(`<g clip-path="url(#${id})">`);
      st.openGroups++;
      ctx.stats.clips++;
      ctx.clipBoxes.push(pathBBox(path, st.ctm));
    };
    const emitPaint = (kind: string): void => {
      let d = pathD(path, st.ctm);
      if (!d) return;
      const closeIt = kind === 's' || kind === 'b' || kind === 'b*';
      if (closeIt && !/Z\s*$/.test(d)) d += ' Z';
      const doFill = kind !== 'S' && kind !== 's';
      const doStroke = kind === 'S' || kind === 's' || kind === 'B' || kind === 'B*' || kind === 'b' || kind === 'b*';
      const evenOdd = kind === 'f*' || kind === 'B*';
      let attrs = `d="${d}"`;
      if (doFill) {
        attrs += ` fill="${fillPaint()}"`;
        if (evenOdd) attrs += ' fill-rule="evenodd"';
        if (st.fillA < 1) attrs += ` fill-opacity="${num(st.fillA)}"`;
      } else {
        attrs += ' fill="none"';
      }
      if (doStroke) {
        attrs += ` stroke="${strokePaint()}" stroke-width="${num(Math.max(0, st.lw * scaleOf(st.ctm)))}"`;
        attrs += ` stroke-linecap="${['butt', 'round', 'square'][st.cap] ?? 'butt'}"`;
        attrs += ` stroke-linejoin="${['miter', 'round', 'bevel'][st.join] ?? 'miter'}"`;
        if (st.join === 0) attrs += ` stroke-miterlimit="${num(st.miter)}"`;
        if (st.dash && st.dash.length && st.dash.some((x: number) => x > 0)) {
          attrs += ` stroke-dasharray="${st.dash.map((x: number) => num(x * scaleOf(st.ctm))).join(' ')}"`;
        }
        if (st.strokeA < 1) attrs += ` stroke-opacity="${num(st.strokeA)}"`;
      } else {
        attrs += ' stroke="none"';
      }
      ctx.body.push(`<path ${attrs}/>`);
      ctx.stats.shapes++;
    };
    const emitText = (text: string): void => {
      if (!text) return;
      const tm = st.tm ?? [1, 0, 0, 1, 0, 0];
      const trm = mul(tm, st.ctm);
      // Counter-flip so glyphs stay upright under the page-level y flip:
      // transform = TRM x diag(1,-1).
      const m = [trm[0], trm[1], -trm[2], -trm[3], trm[4], trm[5]];
      ctx.body.push(
        `<text transform="matrix(${m.map(num).join(' ')})" x="0" y="0" font-family="${esc(st.font || 'sans-serif')}" font-size="${num(st.fontSize)}" fill="${fillPaint()}"${st.fillA < 1 ? ` fill-opacity="${num(st.fillA)}"` : ''} xml:space="preserve">${esc(text)}</text>`,
      );
      ctx.stats.texts++;
      ctx.textApprox = true;
    };

    for (const { op, args } of ops) {
      done++;
      if (done % 400 === 0) {
        if (ctx.onProgress) ctx.onProgress(0.25 + 0.65 * Math.min(1, done / Math.max(1, total)));
        await yieldToUI(signal);
      }
      if (op === 'NUM' || op === 'STR' || op === 'ARR' || op === 'DICT') {
        operands.push(args[0]);
        continue;
      }
      if (op === 'NAME') {
        operands.push({ name: args[0] });
        continue;
      }
      switch (op) {
        case 'q':
          ctx.stack.push({ ...st, clips: [...st.clips] });
          st.pendingClip = null;
          break;
        case 'Q': {
          for (let g = 0; g < st.openGroups; g++) ctx.body.push('</g>');
          if (st.clips.length) ctx.clipBoxes.length = Math.max(0, ctx.clipBoxes.length - st.clips.length);
          const prev = ctx.stack.pop() ?? newState(st.ctm);
          Object.assign(st, prev);
          break;
        }
        case 'cm': {
          const a = operands.slice(-6).map(Number);
          if (a.length === 6) st.ctm = mul(a, st.ctm);
          break;
        }
        case 'w':
          st.lw = Math.max(0, Number(operands[operands.length - 1]) || 0);
          break;
        case 'J':
          st.cap = Number(operands[operands.length - 1]) || 0;
          break;
        case 'j':
          st.join = Number(operands[operands.length - 1]) || 0;
          break;
        case 'M':
          st.miter = Number(operands[operands.length - 1]) || 10;
          break;
        case 'd': {
          const arr = operands.find((o) => Array.isArray(o));
          st.dash = Array.isArray(arr) ? arr.map((x) => Number(x) || 0) : null;
          break;
        }
        case 'gs': {
          const nm = operands.find((o) => o && o.name);
          const gs = nm ? deref(b, objects, resources?.ExtGState?.[nm.name]) : null;
          if (gs) {
            if (Number.isFinite(Number(gs.ca))) st.fillA = Math.max(0, Math.min(1, Number(gs.ca)));
            if (Number.isFinite(Number(gs.CA))) st.strokeA = Math.max(0, Math.min(1, Number(gs.CA)));
            if (Number.isFinite(Number(gs.LW))) st.lw = Math.max(0, Number(gs.LW));
            if (Number.isFinite(Number(gs.LC))) st.cap = Number(gs.LC);
            if (Number.isFinite(Number(gs.LJ))) st.join = Number(gs.LJ);
            if (Number.isFinite(Number(gs.ML))) st.miter = Number(gs.ML);
            if (Array.isArray(gs.D)) st.dash = gs.D[0];
            if (Array.isArray(gs.Font)) {
              st.font = String(gs.Font[0] ?? '');
              st.fontSize = Number(gs.Font[1]) || st.fontSize;
            }
          }
          break;
        }
        case 'm': {
          const a = operands.slice(-2).map(Number);
          if (a.length === 2) {
            path.push({ t: 'M', x: a[0], y: a[1] });
            cur = [a[0], a[1]];
          }
          break;
        }
        case 'l': {
          const a = operands.slice(-2).map(Number);
          if (a.length === 2 && cur) {
            path.push({ t: 'L', x: a[0], y: a[1] });
            cur = [a[0], a[1]];
          }
          break;
        }
        case 'c': {
          const a = operands.slice(-6).map(Number);
          if (a.length === 6 && cur) {
            path.push({ t: 'C', x1: a[0], y1: a[1], x2: a[2], y2: a[3], x: a[4], y: a[5] });
            cur = [a[4], a[5]];
          }
          break;
        }
        case 'v': {
          const a = operands.slice(-4).map(Number);
          if (a.length === 4 && cur) {
            path.push({ t: 'C', x1: cur[0], y1: cur[1], x2: a[0], y2: a[1], x: a[2], y: a[3] });
            cur = [a[2], a[3]];
          }
          break;
        }
        case 'y': {
          const a = operands.slice(-4).map(Number);
          if (a.length === 4 && cur) {
            path.push({ t: 'C', x1: a[0], y1: a[1], x2: a[2], y2: a[3], x: a[2], y: a[3] });
            cur = [a[2], a[3]];
          }
          break;
        }
        case 're': {
          const a = operands.slice(-4).map(Number);
          if (a.length === 4) {
            const [x, y, w, h] = a;
            path.push({ t: 'M', x, y });
            path.push({ t: 'L', x, y: y + h });
            path.push({ t: 'L', x: x + w, y: y + h });
            path.push({ t: 'L', x: x + w, y });
            path.push({ t: 'Z' });
            cur = [x, y];
          }
          break;
        }
        case 'h':
          path.push({ t: 'Z' });
          break;
        case 'W':
          pendingClipRule = 'nonzero';
          break;
        case 'W*':
          pendingClipRule = 'evenodd';
          break;
        case 'n':
          if (pendingClipRule) applyClip(pendingClipRule);
          pendingClipRule = null;
          path.length = 0;
          cur = null;
          break;
        case 'S':
        case 's':
        case 'f':
        case 'F':
        case 'f*':
        case 'B':
        case 'B*':
        case 'b':
        case 'b*':
          emitPaint(op);
          path.length = 0;
          cur = null;
          break;
        case 'BT':
          st.tm = [1, 0, 0, 1, 0, 0];
          st.tlm = [1, 0, 0, 1, 0, 0];
          break;
        case 'ET':
          break;
        case 'Tf': {
          st.fontSize = Number(operands[operands.length - 1]) || st.fontSize;
          const f = operands.find((o) => o && o.name);
          if (f) {
            const fd = deref(b, objects, resources?.Font?.[f.name]);
            const base = String(fd?.BaseFont ?? '').replace(/^[A-Z]{6}\+/, '');
            st.font = base || f.name;
          }
          break;
        }
        case 'Td': {
          const a = operands.slice(-2).map(Number);
          st.tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], st.tlm ?? [1, 0, 0, 1, 0, 0]);
          st.tm = st.tlm;
          break;
        }
        case 'TD': {
          const a = operands.slice(-2).map(Number);
          st.leading = -(a[1] || 0);
          st.tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], st.tlm ?? [1, 0, 0, 1, 0, 0]);
          st.tm = st.tlm;
          break;
        }
        case 'Tm': {
          const a = operands.slice(-6).map(Number);
          if (a.length === 6) st.tm = st.tlm = a;
          break;
        }
        case 'TL':
          st.leading = Number(operands[operands.length - 1]) || 0;
          break;
        case 'T*':
          st.tlm = mul([1, 0, 0, 1, 0, -st.leading], st.tlm ?? [1, 0, 0, 1, 0, 0]);
          st.tm = st.tlm;
          break;
        case 'Tj': {
          const s = operands.find((o) => typeof o === 'string');
          emitText(s ?? '');
          break;
        }
        case "'":
          st.tlm = mul([1, 0, 0, 1, 0, -st.leading], st.tlm ?? [1, 0, 0, 1, 0, 0]);
          st.tm = st.tlm;
          emitText(operands.find((o) => typeof o === 'string') ?? '');
          break;
        case '"': {
          const strs = operands.filter((o) => typeof o === 'string');
          st.tlm = mul([1, 0, 0, 1, 0, -st.leading], st.tlm ?? [1, 0, 0, 1, 0, 0]);
          st.tm = st.tlm;
          emitText(strs[strs.length - 1] ?? '');
          break;
        }
        case 'TJ': {
          const arr = operands[operands.length - 1];
          if (Array.isArray(arr)) {
            const s = arr
              .map((piece: any) =>
                typeof piece === 'string'
                  ? piece
                  : typeof piece === 'object' && piece && typeof piece.text === 'string'
                    ? piece.text
                    : '',
              )
              .join('');
            emitText(s);
          }
          break;
        }
        case 'g':
          st.fill = compsToRgb([Number(operands[operands.length - 1]) || 0], 'gray');
          st.fillPat = null;
          break;
        case 'rg':
          st.fill = compsToRgb(operands.slice(-3).map(Number), 'rgb');
          st.fillPat = null;
          break;
        case 'k': {
          const a = operands.slice(-4).map(Number);
          st.fill = cmykToRgb(a[0] || 0, a[1] || 0, a[2] || 0, a[3] || 0);
          st.fillPat = null;
          break;
        }
        case 'G':
          st.stroke = compsToRgb([Number(operands[operands.length - 1]) || 0], 'gray');
          st.strokePat = null;
          break;
        case 'RG':
          st.stroke = compsToRgb(operands.slice(-3).map(Number), 'rgb');
          st.strokePat = null;
          break;
        case 'K': {
          const a = operands.slice(-4).map(Number);
          st.stroke = cmykToRgb(a[0] || 0, a[1] || 0, a[2] || 0, a[3] || 0);
          st.strokePat = null;
          break;
        }
        case 'cs': {
          const nm = operands.find((o) => o && o.name);
          st.fillCs = resolveCs(b, objects, resources, nm?.name);
          break;
        }
        case 'CS': {
          const nm = operands.find((o) => o && o.name);
          st.strokeCs = resolveCs(b, objects, resources, nm?.name);
          break;
        }
        case 'sc':
        case 'scn': {
          const c = colorFrom(st.fillCs, operands);
          if (typeof c === 'object') {
            const id = c.pattern ? patternDef(b, objects, ctx, st, resources, c.pattern) : '';
            st.fillPat = id || null;
            st.fill = '#000000';
          } else {
            st.fill = c;
            st.fillPat = null;
          }
          break;
        }
        case 'SC':
        case 'SCN': {
          const c = colorFrom(st.strokeCs, operands);
          if (typeof c === 'object') {
            const id = c.pattern ? patternDef(b, objects, ctx, st, resources, c.pattern) : '';
            st.strokePat = id || null;
            st.stroke = '#000000';
          } else {
            st.stroke = c;
            st.strokePat = null;
          }
          break;
        }
        case 'Do': {
          const nm = operands.find((o) => o && o.name);
          const res = resources?.XObject?.[nm?.name];
          const ref = res && res.ref !== undefined ? res.ref : null;
          if (ref === null) break;
          const probe = readObject(b, objects, ref);
          const subtype = String(probe?.dict?.Subtype ?? '');
          if (subtype === 'Image') {
            await emitImage(ctx, st, b, objects, ref);
          } else if (probe && probe.dict) {
            // Form XObject: own state (spec resets colors), inherited resources.
            const fm = Array.isArray(probe.dict.Matrix) ? probe.dict.Matrix : [1, 0, 0, 1, 0, 0];
            const inner = newState(mul(fm, st.ctm));
            const formRes = probe.dict.Resources ?? resources;
            const fd = probe.__stream;
            let decoded: Uint8Array | null = fd;
            if (fd) {
              const filter = probe.dict.Filter;
              const fl = (Array.isArray(filter) ? filter : filter ? [filter] : []).map((f: any) =>
                deref(b, objects, f)
              );
              if (fl.includes('FlateDecode')) decoded = await flate(fd, ctx.warn);
              else if (fl.length) decoded = null;
              if (decoded) await interpret(b, objects, decoded, formRes, ctx, inner, depth + 1);
            }
          }
          break;
        }
        case 'sh': {
          const nm = operands.find((o) => o && o.name);
          const sh = nm ? deref(b, objects, resources?.Shading?.[nm.name]) : null;
          if (sh) await emitShading(b, objects, ctx, st, sh.dict ?? sh);
          else ctx.stats.skipped++;
          break;
        }
        case 'BI': {
          // inline image: skip its payload to EI (rare in AI output)
          ctx.stats.skipped++;
          break;
        }
        case 'BDC':
        case 'EMC':
        case 'MP':
        case 'DP':
        case 'd0':
        case 'd1':
          break;
        default:
          // Illustrator private tokens (ED, llu, ...) and unsupported ops.
          unknown++;
          break;
      }
      operands.length = 0;
    }
    for (let g = 0; g < st.openGroups; g++) ctx.body.push('</g>');
    st.openGroups = 0;
    if (unknown > 0) ctx.warn(`Ignored ${unknown} non-PDF operators (AI private data)`);
  }

  function resolveCs(b: Uint8Array, objects: Map<number, number>, resources: any, name: string): any {
    if (!name) return { kind: 'rgb' };
    if (name === 'DeviceGray' || name === 'CalGray') return { kind: 'gray' };
    if (name === 'DeviceCMYK' || name === 'CalCMYK') return { kind: 'cmyk' };
    if (name === 'DeviceRGB' || name === 'CalRGB') return { kind: 'rgb' };
    if (name === 'Pattern') return { kind: 'pattern' };
    const cs = deref(b, objects, resources?.ColorSpace?.[name]);
    return colorspaceInfo(b, objects, cs);
  }

  /** Map a pattern resource to a gradient def; returns the def id or ''. */
  function patternDef(
    b: Uint8Array,
    objects: Map<number, number>,
    ctx: any,
    st: any,
    resources: any,
    name: string
  ): string {
    const pat = deref(b, objects, resources?.Pattern?.[name]);
    const dict = pat && pat.dict ? pat.dict : pat;
    if (!dict) return '';
    if (Number(dict.PatternType) === 2) {
      const sh = deref(b, objects, dict.Shading);
      return sh ? shadingDef(b, objects, ctx, st, sh.dict ?? sh) : '';
    }
    if (dict.Shading) {
      const sh = deref(b, objects, dict.Shading);
      return sh ? shadingDef(b, objects, ctx, st, sh.dict ?? sh) : '';
    }
    ctx.warn('Pattern fill approximated as solid');
    return '';
  }

  // ------------------------------------------------------- pages

  function findPageNumbers(b: Uint8Array, objects: Map<number, number>): number[] {
    let rootPages = false;
    for (const [n] of objects) {
      const o = readObject(b, objects, n);
      if (o && o.dict && o.dict.Type === 'Pages' && o.dict.Parent === undefined) {
        rootPages = true;
        break;
      }
    }
    const order: number[] = [];
    const seen = new Set<number>();
    const walk = (num: number, depth: number): void => {
      if (seen.has(num) || depth > 32) return;
      seen.add(num);
      const o = readObject(b, objects, num);
      const dict = o && o.dict ? o.dict : null;
      if (!dict) return;
      if (dict.Type === 'Page') {
        order.push(num);
        return;
      }
      const kids = Array.isArray(dict.Kids) ? dict.Kids : [];
      for (const k of kids) {
        if (k && k.ref !== undefined) walk(k.ref, depth + 1);
      }
    };
    if (rootPages) {
      // rootPages was read without its object number; find it again.
      for (const [n] of objects) {
        const o = readObject(b, objects, n);
        if (o && o.dict && o.dict.Type === 'Pages' && o.dict.Parent === undefined) {
          walk(n, 0);
          break;
        }
      }
    }
    // Illustrator multi-artboard files sometimes orphan pages: the Pages
    // tree lists only one while more /Type /Page objects exist. Append any
    // scanned pages the tree missed (document order) so those artboards
    // still import.
    for (const [n] of objects) {
      if (seen.has(n)) continue;
      const o = readObject(b, objects, n);
      if (o && o.dict && o.dict.Type === 'Page' && o.dict.Parent !== undefined) order.push(n);
    }
    return order;
  }

  /**
   * Parse an AI (PDF-compatible) / PDF file into per-page SVGs.
   * Throws with an English message on unsupported input.
   */
  async function parse(bytes: Uint8Array, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<AiDocument> {
    const head = latin.decode(bytes.subarray(0, 5));
    if (head.startsWith('%!PS')) {
      throw Error(
        'This .ai file was saved without PDF compatibility. Re-save it from Illustrator with "Create PDF Compatible File" enabled, or export an SVG instead.'
      );
    }
    if (!head.startsWith('%PDF')) throw Error('Not an AI or PDF file');
    const tail = latin.decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
    if (tail.includes('/Encrypt')) throw Error('Encrypted AI/PDF files are not supported');
    const objects = scanObjects(bytes);
    if (!objects.size) throw Error('No PDF objects found');
    const warnings = new Map();
    const warn = (s) => warnings.set(s, (warnings.get(s) || 0) + 1);
    const pageNums = findPageNumbers(bytes, objects);
    if (!pageNums.length) throw Error('No pages found in AI/PDF file');
    if (onProgress) onProgress(0.1);
    await yieldToUI(signal);
    const pages: AiPage[] = [];
    for (let k = 0; k < pageNums.length; k++) {
      const pageDict = (readObject(bytes, objects, pageNums[k]) ?? {}).dict ?? {};
      const box = Array.isArray(pageDict.MediaBox)
        ? pageDict.MediaBox.map(Number)
        : [0, 0, 612, 792];
      const [x0, y0, x1, y1] = box.length === 4 ? box : [0, 0, 612, 792];
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      if (!w || !h) throw Error('Invalid page size');
      const resources = pageDict.Resources
        ? deref(bytes, objects, pageDict.Resources)
        : {};
      const contents: number[] = [];
      const c = pageDict.Contents;
      if (c && c.ref !== undefined) contents.push(c.ref);
      else if (Array.isArray(c)) {
        for (const piece of c) if (piece && piece.ref !== undefined) contents.push(piece.ref);
      }
      const stats = { shapes: 0, texts: 0, images: 0, clips: 0, skipped: 0 };
      const defs: string[] = [];
      const body: string[] = [];
      const clipBoxes: number[][] = [];
      const ctx = {
        defs,
        body,
        stats,
        clipBoxes,
        clipN: 0,
        shadeN: 0,
        stack: [] as any[],
        pageBox: [x0, y0, x1, y1],
        warn,
        onProgress: onProgress
          ? (f: number) => onProgress(Math.min(0.95, 0.1 + 0.85 * ((k + f) / pageNums.length)))
          : null,
        textApprox: false,
      };
      for (const cn of contents) {
        const obj = readObject(bytes, objects, cn);
        if (!obj || !obj.__stream) continue;
        let data: Uint8Array = obj.__stream;
        const filter = obj.dict.Filter;
        const fl = (Array.isArray(filter) ? filter : filter ? [filter] : []).map((f: any) =>
          deref(bytes, objects, f)
        );
        if (fl.includes('FlateDecode')) {
          data = (await flate(obj.__stream, warn)) ?? new Uint8Array(0);
        } else if (fl.length && !fl.every((f) => f === 'DCTDecode' || f === 'DCT')) {
          warn('Unsupported content filter ' + fl.join('/'));
          continue;
        }
        const st = newState([1, 0, 0, 1, 0, 0]);
        await interpret(bytes, objects, data, resources, ctx, st, 0);
      }
      if (ctx.textApprox) warn('Text encoding approximated (subset fonts)');
      const svg =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w * AI_PT_TO_PX)}px" height="${num(h * AI_PT_TO_PX)}px" viewBox="${num(x0)} ${num(y0)} ${num(w)} ${num(h)}">\n` +
        `<defs>${defs.join('\n')}</defs>\n` +
        `<g transform="matrix(1 0 0 -1 ${num(-x0)} ${num(y1)})">${body.join('\n')}</g>\n` +
        `</svg>`;
      pages.push({ svg, width: w * AI_PT_TO_PX, height: h * AI_PT_TO_PX, stats });
      if (onProgress) onProgress(0.1 + (0.85 * (k + 1)) / pageNums.length);
      await yieldToUI(signal);
    }
    if (!pages.length) throw Error('No convertible pages found');
    const meaningful = pages.some((p) => p.stats.shapes > 0 || p.stats.images > 0);
    if (!meaningful && latin.decode(bytes).includes('AIPrivateData')) {
      // Illustrator writes its native artwork into AIPrivateData streams;
      // without PDF compatibility the page content is a text-only stub.
      throw Error(
        'This .ai file was saved without PDF compatibility (its PDF part carries no artwork). Re-save it from Illustrator with "Create PDF Compatible File" enabled, or export an SVG instead.'
      );
    }
    if (onProgress) onProgress(1);
    return { pages, warnings: [...warnings].map(([s, n]) => `${s} (${n})`) };
  }

  return { parse };
})();

/**
 * Parse an AI (PDF-compatible) / PDF file into per-page SVGs at 96dpi.
 * Throws with an English message on unsupported input (EPS-style .ai,
 * encrypted files).
 */
export async function parseAiBytes(
  bytes: Uint8Array,
  onProgress?: (f: number) => void,
  /** Aborting unwinds at the next yield point; see yieldToUI above. */
  signal?: AbortSignal
): Promise<AiDocument> {
  return AI.parse(bytes, onProgress, signal);
}
