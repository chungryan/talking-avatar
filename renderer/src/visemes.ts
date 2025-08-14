export type Viseme = { timeMs: number; type: string };

export function currentViseme(m: Viseme[] = [], tMs: number) {
  if (!m.length) return "rest";
  let last = "rest";
  for (const v of m) { if (tMs >= v.timeMs) last = v.type; else break; }
  return last;
}

export function visemeOpenAmount(v: string) {
  switch (v) {
    case "aa": case "ae": case "ah": return 1.0;
    case "ao": case "ow":           return 0.8;
    case "uw": case "uh":           return 0.6;
    case "iy": case "ih":           return 0.4;
    case "t": case "d": case "s": case "z": return 0.25;
    case "p": case "b": case "m":   return 0.1;
    case "SIL":                     return 0.05;
    default:                        return 0.5;
  }
}
