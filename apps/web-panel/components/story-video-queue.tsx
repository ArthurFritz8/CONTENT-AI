"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {ListPlus,RefreshCw,Trash2} from "lucide-react";
import type {videoQueuePreview} from "../lib/video-queue";
type QueueView=ReturnType<typeof videoQueuePreview>;
const statuses:Record<string,string>={prepared:"Pronto para entrar na fila",planned:"Capítulo completo cabe na previsão",waiting_capacity:"Aguardando fonte ou saldo confirmado",
 waiting_review:"Aguardando aprovação do capítulo anterior",waiting_previous_chapter:"Aguardando capítulo anterior",reconciliation_required:"Aguardando conciliação",
 reserved:"Saldo reservado",script_changed:"Roteiro ou perfil alterado",existing_video_work:"Já existe trabalho para este capítulo",
 awaiting_preparation:"Aguardando preparação das cenas",planning_unavailable:"Planejamento pendente"};
const reasons:Record<string,string>={unavailable:"Fonte indisponível ou com verificação pendente",stale_capacity:"Consulta de saldo vencida",cooldown:"Fonte em pausa",
 non_recurring_offer:"Créditos promocionais não elegíveis",unverified_free_access:"Gratuidade recorrente não confirmada",cash_not_allowed:"Custo em dinheiro não permitido",
 series_incompatible:"Padrão da novela ainda não aprovado nesta fonte",incompatible_task:"Tipo de cena incompatível",quality_contract:"Qualidade incompatível",
 unknown_capacity:"Saldo não confirmado",free_quota_exhausted:"Saldo insuficiente para o capítulo inteiro",shared_quota:"Cota compartilhada",wallet_reconciliation_required:"Envio anterior em conciliação"};
export function StoryVideoQueue({refresh,onSaved}:{refresh:number;onSaved:()=>void}) {
 const [data,setData]=useState<QueueView|null>(null),[error,setError]=useState(""),[loadError,setLoadError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
 const requests=useRef(new Map<string,string>());
 useEffect(()=>{
  const controller=new AbortController();
  async function load(){try{
   const response=await fetch("/api/stories/queue",{signal:controller.signal,cache:"no-store"}),result=await response.json();
   if(!response.ok)throw Error(result.error||"Fila indisponível.");
  if(!controller.signal.aborted){setData(result);setLoadError("");}
  }catch(value){if(!controller.signal.aborted)setLoadError(value instanceof Error?value.message:"Fila indisponível.");}}
  void load();const timer=setInterval(()=>void load(),30000);return()=>{controller.abort();clearInterval(timer);};
 },[refresh,version]);
 async function command(item:QueueView["items"][number],action:"enqueue"|"cancel") {
  setBusy(true);setError("");setNotice("");
  try {
   if(!requests.current.has(item.episode_id))requests.current.set(item.episode_id,crypto.randomUUID());
   const payload=action==="enqueue"?{action,episodeId:item.episode_id,requestId:requests.current.get(item.episode_id)}:{action,queueId:item.queue_id,revision:item.revision};
   const response=await fetch("/api/stories/queue",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),result=await response.json();
   if(!response.ok)throw Error(result.error||"Não foi possível atualizar a fila.");
   if(!["queued","existing","cancelled"].includes(result.code))throw Error(result.code==="queue_version_changed"?"A fila mudou. Atualize antes de continuar.":"Este capítulo já tem trabalho reservado ou precisa de nova preparação.");
   requests.current.delete(item.episode_id);setNotice(action==="cancel"?"Entrada cancelada.":"Capítulo adicionado à fila. Nenhum crédito foi reservado.");onSaved();
  }catch(value){setError(value instanceof Error?value.message:"Não foi possível atualizar a fila.");}
  finally{setBusy(false);setVersion(value=>value+1);}
 }
 return <section className="panel studio-feature" aria-label="Fila de animação">
  <div className="studio-actions"><h2>Fila de animação</h2><button className="button" title="Atualizar fila" aria-label="Atualizar fila" disabled={busy} onClick={()=>setVersion(value=>value+1)}><RefreshCw size={16}/></button></div>
  {(error||loadError)&&<p role="alert" className="error">{error||loadError}</p>}{notice&&<p role="status">{notice}</p>}
  {!data&&!loadError&&<p role="status">Consultando fila…</p>}
  {data&&<>
  <p role="status"><strong>{data.reservation_enabled?"Reservas habilitadas no servidor":"Reservas desativadas"}</strong> · {data.estimated_complete_chapters===1?"1 capítulo completo previsto":`${data.estimated_complete_chapters} capítulos completos previstos`} · {data.estimated_new_animated_seconds.toLocaleString("pt-BR")}s estimados</p>
   {data.truncated&&<p role="status">Primeiros 100 capítulos. Previsão de capacidade suspensa até conferir a fila completa.</p>}
   {!data.items.length?<p>Nenhum capítulo preparado aguardando nesta fila.</p>:<ol className="video-queue-list">{data.items.map(item=><li key={item.episode_id}>
    <div><Link href={`/studio/episodes/${item.episode_id}`}>{item.title} · capítulo {item.chapter_number}</Link><p>{statuses[item.status]||"Conferência pendente"}{item.source_label?` · ${item.source_label}`:""}</p>
     {item.status==="waiting_capacity"&&item.reasons.length>0&&<ul>{item.reasons.map(reason=><li key={reason}>{reasons[reason]||"Verificação da fonte pendente"}</li>)}</ul>}
    </div>
    <div className="studio-actions">{item.can_enqueue&&<button className="button" disabled={busy} onClick={()=>void command(item,"enqueue")}><ListPlus size={16}/>Adicionar à fila</button>}
     {item.state==="pending"&&<button className="button" title={`Cancelar entrada de ${item.title}`} aria-label={`Cancelar entrada de ${item.title}`} disabled={busy} onClick={()=>void command(item,"cancel")}><Trash2 size={16}/></button>}</div>
   </li>)}</ol>}
  </>}
 </section>;
}