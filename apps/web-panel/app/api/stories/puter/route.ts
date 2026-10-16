import {randomUUID} from "node:crypto";
import {appUrl,body,errorResponse,requireUser} from "../../../../lib/server";
import {assertOrigin,PanelError,uuid} from "../../../../lib/security.mjs";
import {studioRpc} from "../../../../lib/workspace";
import {PuterVideoProvider} from "../../../../../../apps/local-renderer/src/puter-video-provider";
export const dynamic="force-dynamic";
export async function GET() {
 try{const user=await requireUser();return Response.json(await studioRpc("studio_puter_view",{p_workspace:user.workspaceId,p_actor:user.id}),{headers:{"Cache-Control":"no-store"}});}
 catch(e){return errorResponse(e);}
}
export async function POST(request:Request) {
 try {
  assertOrigin(request,appUrl());const user=await requireUser(),input=await body(request),scope={p_workspace:user.workspaceId,p_actor:user.id};
  if(input.action==="connect") {
   if(typeof input.token!=="string"||input.token.length<16||input.token.length>8192||/\s/.test(input.token))throw new PanelError("Informe o token criado na sua conta Puter.",400);
   const observation=await new PuterVideoProvider(input.token).inspect();
   if(!observation.financially_eligible)throw new PanelError("A conta ou o modelo não atendem à configuração gratuita. Confira o plano Free, a confirmação do e-mail e o espaço disponível.",409);
   const result=await studioRpc("studio_puter_connect",{...scope,p_token:input.token,p_observation:observation});
   return Response.json({code:result.code},{headers:{"Cache-Control":"no-store"}});
  }
  if(input.action!=="refresh")throw new PanelError("Operação inválida.",400);
  const base={p_account:uuid(input.accountId),p_token:randomUUID()};
  const claim=await studioRpc("claim_puter_inspection",{...scope,...base});
  if(claim.code!=="claimed")return Response.json({code:claim.code},{headers:{"Cache-Control":"no-store"}});
  try {
   const observation=await new PuterVideoProvider(claim.credential).inspect();
   await studioRpc("finish_puter_inspection",{...base,p_observation:observation});
   return Response.json({code:"updated"},{headers:{"Cache-Control":"no-store"}});
  }catch {
   await studioRpc("finish_puter_inspection",{...base,p_observation:null,p_error:"inspection_unavailable"});
   throw new PanelError("Não foi possível confirmar o saldo. O último valor foi preservado como histórico.",503);
  }
 }catch(e){return errorResponse(e);}
}
