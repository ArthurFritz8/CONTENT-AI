import {test} from "node:test";
import {strictEqual,deepStrictEqual,rejects} from "node:assert";
import {deployVerifiedPanel} from "../../../scripts/deploy-verified-panel.mjs";
const sha="a".repeat(40),other="b".repeat(40);
const config={repo:"audit/studio",token:"dummy",site:"https://panel.test",hook:"https://api.render.com/deploy/srv-test?key=dummy"};
function fixture({ci="success",health=["old",sha],main=[sha,sha],hookStatus=200}={}) {
  let triggers=0;const requested=[];
  const fetcher=async(input,init)=>{
    const url=new URL(input);requested.push(url.hostname);
    if(url.hostname==="api.github.com") {
      strictEqual(init.headers.Authorization,"Bearer dummy");
      if(url.pathname.endsWith("/commits/main"))return Response.json({sha:main.length>1 ? main.shift() : main[0]});
      return Response.json({workflow_runs:[{head_sha:sha,head_branch:"main",event:"push",status:"completed",conclusion:ci}]});
    }
    if(url.hostname==="api.render.com") {triggers++;strictEqual(init.method,"POST");strictEqual(url.searchParams.get("ref"),sha);strictEqual(init.headers,undefined);return new Response(null,{status:hookStatus});}
    strictEqual(init.headers,undefined);return Response.json({version:health.length>1 ? health.shift() : health[0]});
  };
  return {fetcher,sleep:async()=>{},attempts:2,triggers:()=>triggers,requested};
}
test("scheduled retry publishes only exact main with successful push CI and exact live health",async()=>{
  const f=fixture();deepStrictEqual(await deployVerifiedPanel(config,f),{code:"deployed",sha});strictEqual(f.triggers(),1);
});
test("old CI callbacks, failed CI, already live versions and a concurrent push never trigger a deploy",async()=>{
  for(const [settings,extra,code] of [[{}, {requestedSha:other},"stale_commit"],[{ci:"failure"},{},"ci_not_ready"],[{health:[sha]},{},"already_current"],[{main:[sha,other]},{},"stale_commit"]]) {
    const f=fixture(settings);strictEqual((await deployVerifiedPanel({...config,...extra},f)).code,code);strictEqual(f.triggers(),0);
  }
});
test("Render errors and ambiguous acceptance get no immediate POST retry; old live code is never success",async()=>{
  const failed=fixture({hookStatus:500});await rejects(deployVerifiedPanel(config,failed),/deploy_request_failed_500/);strictEqual(failed.triggers(),1);
  const queued=fixture({hookStatus:202,health:["old"]});await rejects(deployVerifiedPanel(config,queued),/deployment_not_verified/);strictEqual(queued.triggers(),1);
});
test("misconfigured destinations are refused before credentials leave the runner",async()=>{
  for(const hook of ["https://api.render.com.evil.test/deploy/id","https://user:password@api.render.com/deploy/id"]) {
    const f=fixture();await rejects(deployVerifiedPanel({...config,hook},f),/invalid_deployment_config/);strictEqual(f.requested.length,0);
  }
});
