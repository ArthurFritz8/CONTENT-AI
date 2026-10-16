"use client";
import {useState} from "react";
export type PuterAccount={id:string;remaining_credits:number|null;monthly_allowance:number|null;checked_at:string|null;balance_fresh:boolean;financially_eligible:boolean;estimated_chapters:number|null;estimated_seconds:number|null;reserved?:boolean;busy:boolean;sync_failed:boolean;blockers:string[]};
export type PuterView={enabled:boolean;accounts:PuterAccount[]};
export function StoryPuterSource({view,onUpdated}:{view?:PuterView;onUpdated:()=>void}) {
 const [token,setToken]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function post(input:unknown){setBusy(true);setMessage("");try{const r=await fetch("/api/stories/puter",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}),d=await r.json();if(!r.ok)throw Error(d.error||"Conexão indisponível.");setToken("");setMessage(({connected:"Puter conectado. Nenhum vídeo foi gerado.",updated:"Saldo atualizado. Nenhum vídeo foi gerado.",cooldown:"Aguarde dois minutos entre consultas.",account_busy:"A conta está ocupada com uma geração. Aguarde a conclusão."} as Record<string,string>)[d.code]||"Confira a conexão.");onUpdated();}catch(e){setMessage(e instanceof Error?e.message:"Conexão indisponível.");}finally{setBusy(false);}}
 return <section className="story-production-setup" aria-label="Saldo e conexão Puter"><h3>Puter · franquia mensal gratuita</h3>
  <p>Wan 2.7 com imagem de referência, áudio nativo e entrega a 30 FPS. A amostra foi aprovada; cada capítulo novo precisa ser revisado.</p>
  {view?.accounts.map(a=><div key={a.id}>
   <p><strong>{a.remaining_credits===null?"Saldo não confirmado":`${a.remaining_credits.toLocaleString("pt-BR",{maximumFractionDigits:1})} de ${a.monthly_allowance??"?"} créditos`}</strong>{!a.balance_fresh&&" · última consulta, atualize antes de gerar"}.</p>
   <p>{a.reserved?"Conta reservada para um capítulo em andamento.":a.balance_fresh&&a.financially_eligible?`Capacidade estimada: ${a.estimated_chapters??0} capítulo(s) completo(s) de 15s. Tomadas avulsas equivalem a até ${a.estimated_seconds??0}s; isso não garante um capítulo completo.`:"Capacidade aguardando confirmação do saldo e da conta gratuita."}</p>
   {a.checked_at&&<small>Consultado em {new Date(a.checked_at).toLocaleString("pt-BR")}.</small>}
   {!!a.blockers.length&&<p role="status">{a.blockers.includes("insufficient_free_credits")?"Saldo abaixo da estimativa para uma nova tomada.":"A conexão, o espaço livre ou as condições gratuitas precisam ser conferidos antes de gerar."}</p>}
   <button className="button secondary" disabled={busy||a.busy} onClick={()=>void post({action:"refresh",accountId:a.id})}>Atualizar saldo Puter</button>
  </div>)}
  <p className="muted">Reserva estimada de 330 créditos por cena de 5s, ou 990 por capítulo de 15s, baseada no teste realizado. O provedor não fornece uma cotação em créditos; a conta também consome franquia com outros usos e transferências. Os saldos de Modal, Auray e Puter não são somados. Sem saldo suficiente, a geração aguarda.</p>
  {view&&!view.enabled&&<p role="status">A criação de capítulos Puter aguarda ativação do administrador.</p>}
  <details><summary>{view?.accounts.length?"Atualizar conexão Puter":"Conectar Puter"}</summary><p>Crie um token em Puter → Account → API tokens. Use uma conta gratuita com e-mail confirmado. O token fica protegido no servidor.</p><label>Token Puter<input type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label><button className="button secondary" disabled={busy||token.length<16} onClick={()=>void post({action:"connect",token})}>Salvar conexão · não gerar vídeo</button></details>
  {message&&<p role="status">{message}</p>}
 </section>;
}
