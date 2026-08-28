// Cadeia de fallback de assets por role (ADR-009) — função pura, testável em Node,
// executada pela Edge Function generate-assets.

export type AssetSourcePlan = "affiliate" | "generated" | "pexels";

export interface PlannableScene {
  order: number;
  role: "hook" | "content" | "cta";
}

export interface AssetPlanInput {
  scenes: PlannableScene[];
  hasAffiliateImage: boolean;
  imageGenerationEnabled: boolean;
  imageQuotaRemaining: number;
}

export interface ScenePlan {
  order: number;
  role: PlannableScene["role"];
  source: AssetSourcePlan;
}

/**
 * hook: afiliado → gerada → pexels | content: gerada → pexels | cta: pexels.
 * Cota de geração é alocada por prioridade: hook primeiro, depois contents em ordem.
 */
export function planAssetSources(input: AssetPlanInput): ScenePlan[] {
  let quota = input.imageGenerationEnabled ? Math.max(0, input.imageQuotaRemaining) : 0;
  const byOrder = [...input.scenes].sort((a, b) => a.order - b.order);

  const plans = new Map<number, ScenePlan>();

  // hook tem prioridade máxima na cota
  for (const scene of byOrder.filter((s) => s.role === "hook")) {
    let source: AssetSourcePlan = "pexels";
    if (input.hasAffiliateImage) {
      source = "affiliate";
    } else if (quota > 0) {
      source = "generated";
      quota -= 1;
    }
    plans.set(scene.order, { order: scene.order, role: scene.role, source });
  }

  for (const scene of byOrder.filter((s) => s.role === "content")) {
    let source: AssetSourcePlan = "pexels";
    if (quota > 0) {
      source = "generated";
      quota -= 1;
    }
    plans.set(scene.order, { order: scene.order, role: scene.role, source });
  }

  for (const scene of byOrder.filter((s) => s.role === "cta")) {
    plans.set(scene.order, { order: scene.order, role: scene.role, source: "pexels" });
  }

  return byOrder.map((s) => plans.get(s.order)!);
}
