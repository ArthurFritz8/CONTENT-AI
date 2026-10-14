import {deployVerifiedPanel,PanelDeploymentError} from "./deploy-verified-panel.mjs";
try {
  const {RENDER_DEPLOY_HOOK:hook,PANEL_PUBLIC_URL:site,VERIFIED_SHA:requestedSha,GH_TOKEN:token,REPOSITORY:repo}=process.env;
  if(!hook || !site){console.log(JSON.stringify({code:"deployment_not_configured"}));}
  else console.log(JSON.stringify(await deployVerifiedPanel({hook,site,requestedSha,token,repo})));
}catch(e){console.error(JSON.stringify({code:e instanceof PanelDeploymentError ? e.code : "deployment_failed"}));process.exitCode=1;}
