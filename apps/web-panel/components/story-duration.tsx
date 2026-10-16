"use client";
import {useRef,useState} from "react";
type Wallet={id:string;label:string;native_enabled?:boolean;balance_fresh?:boolean;sync_failed?:boolean;budget_only_shots?:number|null;source_blockers?:string[]};
export function StoryDuration({seriesId,shots,revision,frozenShots,wallets,onSaved}:{seriesId:string;shots:3|6|9;revision:number;frozenShots?:number;wallets:Wallet[];onSaved:()=>void}) {
 const [selected,setSelected]=useState(shots),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const request=useRef<{shots:number;id:string}|null>(null);
 return <section className="story-production-setup" aria-label="Duração e orçamento" data-format-revision={revision}>
  <h4>Duração e orçamento</h4>
  <label>Duração dos próximos capítulos<select value={selected} disabled={busy} onChange={e=>{setSelected(Number(e.target.value) as 3|6|9);setNotice("");}}>{[3,6,9].map(n=><option key={n} value={n}>Aproximadamente {n*5}s · {n} cenas</option>)}</select></label>
  <p><strong>Reserva por capítulo: {selected*5} créditos gratuitos Auray.</strong></p>
  <p className="muted">Mais duração acrescenta cenas originais a 24 FPS, com áudio nativo. A escolha vale para capítulos ainda não preparados; o padrão visual e as referências permanecem os mesmos. Não há reserva de créditos ao salvar.</p>
  {frozenShots!==undefined&&<p role="status">O capítulo já preparado mantém {frozenShots} cenas, aproximadamente {frozenShots*5}s e custo total de {frozenShots*5} créditos, inclusive numa nova tentativa dele.</p>}
  {wallets.filter(w=>w.native_enabled).map(w=>{
    const fresh=w.balance_fresh===true&&!w.sync_failed&&w.budget_only_shots!=null;
    const count=fresh?Math.floor(w.budget_only_shots!/selected):null;
    return <p key={w.id}>{w.label}: {count===null?"atualize o saldo para estimar a capacidade":`até ${count} capítulo(s) de aproximadamente ${selected*5}s pelo orçamento confirmado, sem reserva para refações`}.{fresh&&!!w.source_blockers?.length&&" A conexão ainda tem pendências indicadas na seção de saldo."} Cada cena refeita exige até cinco créditos adicionais. As capacidades de outras fontes não são somadas.</p>;
  })}
  <button className="button secondary" disabled={busy||selected===shots} onClick={async()=>{
   setBusy(true);setError("");
   if(request.current?.shots!==selected)request.current={shots:selected,id:crypto.randomUUID()};
   try {const r=await fetch("/api/stories",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"duration",seriesId,requestId:request.current.id,revision,shots:selected})});const v=await r.json();if(!r.ok||v.code!=="saved")throw Error(v.code==="revision_changed"?"A duração foi alterada em outra aba. Atualize a página para conferir.":v.error||"Não foi possível salvar a duração.");setNotice("Duração salva para os próximos capítulos. Nenhum vídeo foi gerado.");onSaved();}
   catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}finally{setBusy(false);}
  }}>Salvar duração · nenhum crédito gasto</button>
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
