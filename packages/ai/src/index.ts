import type { AIProvider, AIChatContext, MarketAnalysisSnapshot } from '@dmi/types';
export class AIUnavailableError extends Error {}
const SYSTEM = `You explain pre-computed technical analysis. Use ONLY the JSON facts provided. Never invent prices, indicator values, history, backtests, win rates or events. Never give guaranteed signals or financial advice. If data is missing say: "The available market data does not provide enough information to determine this." Cover: condition, why classified so, key levels, conflicts, what would confirm, what would invalidate.`;
export class GeminiProvider implements AIProvider {
  private cache = new Map<string, { at: number; text: string }>();
  constructor(private key = process.env.GEMINI_API_KEY, private model = process.env.GEMINI_MODEL || 'gemini-2.5-flash', private ttlMs = 5 * 60_000) {}
  get available() { return !!this.key; }
  private async call(prompt: string) {
    if (!this.key) throw new AIUnavailableError('AI Analyst unavailable. The technical analysis engine is still fully operational.');
    const hit = this.cache.get(prompt); if (hit && Date.now() - hit.at < this.ttlMs) return hit.text;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    }).catch(() => null);
    if (!res || !res.ok) throw new AIUnavailableError('AI analysis temporarily unavailable. Technical market analysis remains active.');
    const j: any = await res.json(); const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    this.cache.set(prompt, { at: Date.now(), text }); return text;
  }
  generateAnalysis(s: MarketAnalysisSnapshot) { return this.call(`Explain this snapshot:\n${JSON.stringify(s)}`); }
  chat(c: AIChatContext) {
    const extra = (c.events ? `\n\nRecent events per market|timeframe (oldest to newest):\n${JSON.stringify(c.events)}` : '') + (c.overview ? `\n\nCategory overview:\n${JSON.stringify(c.overview)}` : '');
    return this.call(`Snapshots:\n${JSON.stringify(c.snapshots)}${extra}\n\nQuestion (answer only from the data above): ${c.question}`);
  }
}
