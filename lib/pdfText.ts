/**
 * The standard PDF fonts are WinAnsi only. LLM output routinely contains
 * arrows, ticks, dashes and emoji, which would throw at draw time and break a
 * one-shot evidence submission. Map common symbols, replace anything else.
 * Pure module so it can be unit tested.
 */
export function sanitizePdfText(input: string): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[→⇒➡]/g, "->")
    .replace(/[←⇐]/g, "<-")
    .replace(/[✓✔✅]/g, "[OK]")
    .replace(/[✗✘❌]/g, "[X]")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/×/g, "x")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/•/g, "-")
    .replace(/\t/g, "  ")
    .replace(/[^\x20-\x7e\n]/g, "?");
}
