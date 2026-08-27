/**
 * Warning de desvio TTS (ADR-006): duration_seconds é target, o áudio real manda.
 * Renderer e QA usam esta mesma função — uma fonte de verdade para o gate humano.
 */
export function durationDeviationPercent(targetSeconds: number, actualSeconds: number): number {
  if (targetSeconds <= 0) throw new RangeError("targetSeconds deve ser > 0");
  if (actualSeconds < 0) throw new RangeError("actualSeconds deve ser >= 0");
  return (Math.abs(actualSeconds - targetSeconds) / targetSeconds) * 100;
}

export function exceedsDurationDeviation(
  targetSeconds: number,
  actualSeconds: number,
  thresholdPercent = 50,
): boolean {
  return durationDeviationPercent(targetSeconds, actualSeconds) > thresholdPercent;
}
