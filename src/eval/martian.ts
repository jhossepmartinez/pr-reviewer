import type { GoldenPr, DiffSizeBucket } from "./types.ts";
import type { Severity } from "../types.ts";

export async function loadMartianFixture(dir: string): Promise<GoldenPr[]> {
  const file = Bun.file(`${dir}/martian.json`);
  if (!(await file.exists())) {
    throw new Error(`Martian fixture not found at ${dir}/martian.json`);
  }
  const data = await file.json();
  return data as GoldenPr[];
}

export function getDiffSizeBucket(diff: string): DiffSizeBucket {
  let changed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") || line.startsWith("-")) changed++;
  }
  if (changed < 10) return "<10";
  if (changed <= 50) return "10-50";
  if (changed <= 150) return "50-150";
  return ">150";
}

export function normalizeSeverity(s: string): Severity {
  const v = s.toLowerCase().trim();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}
