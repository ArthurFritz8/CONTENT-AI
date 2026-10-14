/** Recoverable web deployment. The target must be main with a successful push CI. */
export class PanelDeploymentError extends Error {
  constructor(code){super(code);this.name="PanelDeploymentError";this.code=code;}
}
export async function deployVerifiedPanel(config,{fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=60}={}) {
  const {repo,token,site,hook,requestedSha}=config;
  if(!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token || !site || !hook)throw new PanelDeploymentError("deployment_not_configured");
  let base,trigger;
  try {base=new URL(site);trigger=new URL(hook);}catch {throw new PanelDeploymentError("invalid_deployment_config");}
  if(base.protocol!=="https:" || base.username || base.password || base.port ||
    trigger.origin!=="https://api.render.com" || !trigger.pathname.startsWith("/deploy/") || trigger.username || trigger.password ||
    !Number.isSafeInteger(attempts) || attempts<1 || attempts>60)throw new PanelDeploymentError("invalid_deployment_config");
  const github=async(path)=>{
    let r;
    try {r=await fetcher(`https://api.github.com/repos/${repo}/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json"},redirect:"error",signal:AbortSignal.timeout(15000)});}
    catch {throw new PanelDeploymentError("github_unavailable");}
    if(!r.ok)throw new PanelDeploymentError("github_unavailable");
    try {return await r.json();}catch {throw new PanelDeploymentError("github_invalid_response");}
  };
  const commit=await github("commits/main"),sha=commit.sha;
  if(!/^[a-f0-9]{40}$/.test(sha || ""))throw new PanelDeploymentError("invalid_main_commit");
  if(requestedSha && requestedSha!==sha)return {code:"stale_commit",sha};
  const runs=await github(`actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=10`);
  if(!Array.isArray(runs.workflow_runs) || !runs.workflow_runs.some(r=>r.head_sha===sha && r.head_branch==="main" && r.event==="push" && r.status==="completed" && r.conclusion==="success"))
    return {code:"ci_not_ready",sha};
  const healthy=async()=>{
    try {const r=await fetcher(new URL("/api/health",base),{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});return r.ok && (await r.json()).version===sha;}
    catch {return false;}
  };
  if(await healthy())return {code:"already_current",sha};
  if((await github("commits/main")).sha!==sha)return {code:"stale_commit",sha};
  trigger.searchParams.set("ref",sha);
  let started;
  try {started=await fetcher(trigger,{method:"POST",redirect:"error",signal:AbortSignal.timeout(30000)});}
  catch {throw new PanelDeploymentError("deploy_request_unresolved");}
  if(![200,202].includes(started.status))throw new PanelDeploymentError(`deploy_request_failed_${started.status}`);
  for(let i=0;i<attempts;i++) {await sleep(10000);if(await healthy())return {code:"deployed",sha};}
  throw new PanelDeploymentError("deployment_not_verified");
}
