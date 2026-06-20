import type { DiffFile } from "./types.ts";

export interface Hunk {
  file: string;
  status: "added" | "modified" | "removed" | "renamed";
  oldStart: number;
  newStart: number;
  lineCount: number;
  content: string;
  pathContext?: string;
}

export const SWEET_SPOT = { min: 10, max: 50 } as const;
export const HARD_CAP = 150;

interface ParsedHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
  lineCount: number;
}

function parseHunks(patch: string): ParsedHunk[] {
  const out: ParsedHunk[] = [];
  const lines = patch.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const oldStart = parseInt(m[1], 10);
    const newStart = parseInt(m[3], 10);
    i++;
    const body: string[] = [];
    let changed = 0;
    while (i < lines.length && !lines[i].startsWith("@@")) {
      const l = lines[i];
      if (l.startsWith("---") || l.startsWith("+++")) {
        i++;
        continue;
      }
      if (l.startsWith("+")) changed++;
      else if (l.startsWith("-")) changed++;
      else if (l.startsWith("\\")) {
        body.push(l);
        i++;
        continue;
      }
      body.push(l);
      i++;
    }
    out.push({ oldStart, newStart, lines: body, lineCount: changed });
  }
  return out;
}

function derivePathContext(filename: string): string {
  const idx = filename.lastIndexOf("/");
  if (idx <= 0) return "";
  return filename.slice(0, idx + 1);
}

function hunkToContent(oldStart: number, oldLen: number, newStart: number, newLen: number, body: string[]): string {
  const header = `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`;
  return [header, ...body].join("\n");
}

export function splitOversizedHunk(h: Hunk, max: number = SWEET_SPOT.max): Hunk[] {
  if (h.lineCount <= max) return [h];
  const raw = parseHunks(h.content);
  if (raw.length === 0) return [h];
  const parsed = raw[0];
  const body = parsed.lines;
  if (body.length === 0) return [h];

  const target = Math.max(1, Math.floor(max));
  const window = 8;
  const cuts: number[] = [0];
  let changedSinceCut = 0;
  let idx = 0;
  while (idx < body.length) {
    const l = body[idx];
    if (!l.startsWith("\\")) changedSinceCut += l.startsWith("+") || l.startsWith("-") ? 1 : 0;
    if (changedSinceCut >= target) {
      let cutAt = idx + 1;
      if (!l.startsWith(" ")) {
        for (let w = 1; w <= window && idx + w < body.length; w++) {
          const wl = body[idx + w];
          if (wl === " " || wl === "" || wl === "  ") {
            cutAt = idx + w + 1;
            break;
          }
        }
      }
      cuts.push(cutAt);
      changedSinceCut = 0;
      idx = cutAt;
      continue;
    }
    idx++;
  }
  if (cuts[cuts.length - 1] < body.length) cuts.push(body.length);

  const out: Hunk[] = [];
  let oldLine = parsed.oldStart;
  let newLine = parsed.newStart;
  for (let s = 0; s < cuts.length - 1; s++) {
    const startIdx = cuts[s];
    const endIdx = cuts[s + 1];
    if (startIdx >= endIdx) continue;
    const slice = body.slice(startIdx, endIdx);
    let oldLen = 0;
    let newLen = 0;
    let changed = 0;
    let oStart = oldLine;
    let nStart = newLine;
    for (const l of slice) {
      if (l.startsWith("\\")) continue;
      if (l.startsWith("+")) {
        newLen++;
        changed++;
        newLine++;
      } else if (l.startsWith("-")) {
        oldLen++;
        changed++;
        oldLine++;
      } else {
        oldLen++;
        newLen++;
        oldLine++;
        newLine++;
      }
    }
    if (changed === 0) continue;
    oStart = oldLine - oldLen;
    nStart = newLine - newLen;
    out.push({
      file: h.file,
      status: h.status,
      oldStart: oStart,
      newStart: nStart,
      lineCount: changed,
      content: hunkToContent(oStart, oldLen, nStart, newLen, slice),
      pathContext: h.pathContext,
    });
  }
  return out.length > 0 ? out : [h];
}

export function mergeTinyHunks(hs: Hunk[], min: number = SWEET_SPOT.min): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  while (i < hs.length) {
    let cur = hs[i];
    let j = i + 1;
    while (j < hs.length && cur.file === hs[j].file && cur.lineCount < min) {
      const next = hs[j];
      const merged: Hunk = {
        file: cur.file,
        status: cur.status,
        oldStart: cur.oldStart,
        newStart: cur.newStart,
        lineCount: cur.lineCount + next.lineCount,
        content: cur.content + "\n" + next.content,
        pathContext: cur.pathContext,
      };
      cur = merged;
      j++;
    }
    out.push(cur);
    i = j;
  }
  return out;
}

export function chunkDiff(files: DiffFile[]): Hunk[] {
  const all: Hunk[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    const parsed = parseHunks(f.patch);
    const ctx = derivePathContext(f.filename);
    for (const p of parsed) {
      const base: Hunk = {
        file: f.filename,
        status: f.status,
        oldStart: p.oldStart,
        newStart: p.newStart,
        lineCount: p.lineCount,
        content: hunkToContent(p.oldStart, p.lines.length, p.newStart, p.lines.length, p.lines),
        pathContext: ctx,
      };
      const split = base.lineCount > HARD_CAP ? splitOversizedHunk(base, SWEET_SPOT.max) : [base];
      for (const s of split) all.push(s);
    }
  }
  return mergeTinyHunks(all, SWEET_SPOT.min);
}
