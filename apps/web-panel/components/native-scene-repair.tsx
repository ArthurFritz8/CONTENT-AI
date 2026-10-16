"use client";
import Link from "next/link";
import {useRef,useState} from "react";
type Draft={summary:string;scenes:Array<{narration_text:string;prompt:string;visual:{speaker_id:string}}>};
type View={available:boolean;can_repair:boolean;draft:Draft;context:{bible:{cast:Array<{id:string;name:string}>}};versions:Array<{source_episode:string;episode_id:string;shot_index:number;restored:boolean}>};
export function NativeSceneRepair({episode}:{episode:string}) {
 const [view,setView]=useState<View|null>(null),[open,setOpen]=useState(false),[index,setIndex]=useState(0),[line,setLine]=useState(""),[prompt,setPrompt]=useState(""),[summary,setSummary]=useState("");
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState<string|null>(null),[restored,setRestored]=useState(false);
 const request=useRef<{key:string;id:string}|null>(null);
 function choose(v:View,i:number){setIndex(i);setLine(v.draft.scenes[i]!.narration_text);setPrompt(v.draft.scenes[i]!.prompt);setSummary(v.draft.summary);setConfirmed(false);}
 async function run(fn:()=>Promise<void>){setBusy(true);setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Operação indisponível.");}finally{setBusy(false);}}
 async function send(payload:Record<string,unknown>,target=episode){const key=JSON.stringify({target,...payload});if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};const r=await fetch("/api/stories/repair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,episodeId:target,requestId:request.current.id})}),v=await r.json();if(!r.ok)throw Error(v.error||"Não foi possível preparar a correção.");return v;}
 return <section className="panel native-scene-repair" aria-label="Corrigir uma cena"><h3>Corrigir uma cena</h3>
  <p className="muted">Reaproveite duas tomadas e refaça apenas uma por até cinco créditos gratuitos Auray. A nova montagem mantém a resolução e os quadros originais. O vídeo anterior permanece disponível. Cada versão precisa de nova revisão.</p>
  <button className="button secondary" disabled={busy} aria-expanded={open} onClick={()=>{if(open){setOpen(false);return;}setOpen(true);void run(async()=>{const r=await fetch(`/api/stories/repair?episode=${encodeURIComponent(episode)}`),v=await r.json();if(!r.ok)throw Error(v.error||"Correção indisponível.");setView(v);if(v.available)choose(v,0);});}}> {open?"Fechar correção":"Escolher cena para corrigir"}</button>
  {open&&<div className="story-editorial-body">
   {error&&<p role="alert" className="error">{error}</p>}
   {result&&<p role="status">Nova versão em preparação. <Link href={`/studio/episodes/${result}`}>Acompanhar correção</Link></p>}
   {restored&&<p role="status">Versão anterior restaurada para continuidade. Os dois vídeos foram preservados.</p>}
   {view&&!view.can_repair&&<p className="muted">A refação está disponível para o último capítulo nativo em revisão, após concluir a conciliação das cobranças e antes de iniciar a continuação. Uma versão em andamento deve ser concluída ou encerrada primeiro.</p>}
   {view?.can_repair&&!result&&<fieldset disabled={busy}>
    <label>Cena<select value={index} onChange={e=>choose(view,Number(e.target.value))}>{view.draft.scenes.map((s,i)=><option key={i} value={i}>Cena {i+1} · {view.context.bible.cast.find(c=>c.id===s.visual.speaker_id)?.name??s.visual.speaker_id}</option>)}</select></label>
    <label>Fala (3–8 palavras)<input value={line} maxLength={120} onChange={e=>{setLine(e.target.value);setConfirmed(false);}}/></label>
    <label>Direção visual da tomada<textarea rows={3} maxLength={600} value={prompt} onChange={e=>{setPrompt(e.target.value);setConfirmed(false);}}/></label>
    <p className="muted">Você pode manter o texto para tentar outro movimento. Só esta tomada terá uma nova geração; o personagem, a referência e a direção vocal ficam iguais. Se mudar o sentido da fala, atualize o resumo abaixo.</p>
    <label>Resumo da versão corrigida<textarea rows={3} maxLength={1200} value={summary} onChange={e=>{setSummary(e.target.value);setConfirmed(false);}}/></label>
    <label className="story-pin"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Quero gerar uma nova tomada por até cinco créditos gratuitos, conservando as demais tomadas.</label>
    <button className="button primary" disabled={!confirmed} onClick={()=>void run(async()=>{const v=await send({action:"repair",confirmed:true,edit:{index,dialogue:line,prompt,summary}});if(v.code!=="started")throw Error(v.code==="repair_budget_required"?"Atualize o saldo. São necessários cinco créditos gratuitos confirmados e livres; o vídeo anterior foi preservado.":"Este capítulo já mudou ou tem uma continuação. Reabra a página para conferir.");setResult(v.episode_id);})}>Refazer cena {index+1} · até 5 créditos</button>
   </fieldset>}
   {view?.versions.map(v=><div key={v.episode_id}><p>Versão com refação da cena {v.shot_index+1}. <Link href={`/studio/episodes/${v.source_episode}`}>Abrir versão anterior</Link> · <Link href={`/studio/episodes/${v.episode_id}`}>Abrir versão corrigida</Link></p>
     {!v.restored&&!restored&&<button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{const r=await send({action:"restore"},v.episode_id);if(r.code!=="restored")throw Error("Encerre a tentativa e concilie as cobranças antes de restaurar. Uma versão já aprovada ou com continuação não pode ser restaurada por este atalho.");setRestored(true);})}>Voltar à versão anterior</button>}
   </div>)}
  </div>}
 </section>;
}
