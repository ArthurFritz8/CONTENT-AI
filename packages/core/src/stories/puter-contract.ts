/** Recurring free-account contract. Credit budgets are conservative observations, not a provider quote. */
export const NATIVE_PUTER = {
  version:"puter-native-1.0.0",model:"togetherai:wan-ai/wan2.7-i2v",upstream:"together-video-generation",
  contractSha256:"af3cf52f125272b2daee0361659dec3631a6255acaad234a3e47e02b18415364",
  seconds:5,width:720,height:1280,fps:30,creditsPerShot:330,monthlyAllowance:1000,
  budgetBasis:"empirical_conservative_estimate",maxImageBytes:12*1024*1024,maxVideoBytes:50*1024*1024,
} as const;
export const puterContractIdentity={provider:"puter",model:NATIVE_PUTER.model,upstream:NATIVE_PUTER.upstream,
  seconds:5,width:720,height:1280,fps:30,audio:true,catalog_usd_cents_per_second:2,
  monthly_free_credits:1000,budget_credits_per_shot:330,cash_allowed:false} as const;
export function puterBudget(shots:number,remaining:number|null,reserved=0) {
  if(![3,6,9].includes(shots) || !Number.isFinite(reserved) || reserved<0)throw Error("invalid_puter_budget");
  const available=remaining!==null&&Number.isFinite(remaining)&&remaining>=0&&remaining<=NATIVE_PUTER.monthlyAllowance?Math.max(0,remaining-reserved):null;
  const required=shots*NATIVE_PUTER.creditsPerShot;
  return {required_credits:required,available_credits:available,estimated_chapters:available===null?null:Math.floor(available/required),
    estimated_seconds:available===null?null:Math.floor(available/NATIVE_PUTER.creditsPerShot)*NATIVE_PUTER.seconds,
    budget_basis:NATIVE_PUTER.budgetBasis,provider_quote:false as const};
}
