
function classifySignal(output: string): { type: string; confidence: number } {
  const lower = output.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('rate_limit') ||
      lower.includes('429') || lower.includes('too many requests')) {
    return { type: 'RateLimitSignal', confidence: 0.9 };
  }
  if (lower.includes('timeout') || lower.includes('timed out') ||
      lower.includes('deadline')) {
    return { type: 'TimeoutSignal', confidence: 0.8 };
  }
  if (lower.includes('crash') || lower.includes('segfault') ||
      lower.includes('internal error')) {
    return { type: 'CrashSignal', confidence: 0.7 };
  }
  return { type: 'SuccessSignal', confidence: 0.5 };
}
