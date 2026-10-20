"use client";
import {useEffect,useState} from "react";
import {RefreshCw} from "lucide-react";
type Preview={id:string;title:string;source:string;seconds:number;width:number;height:number;output_fps:number;approved_at:string;approval_scope:"sample_only";limitations:string[]};
export function StoryApprovedPreviews({refresh}:{refresh:number}) {
 const [items,setItems]=useState<Preview[]|null>(null),[error,setError]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch("/api/stories/styles",{signal:controller.signal,cache:"no-store"}).then(async response=>{
   if(!response.ok)throw Error();const data=await response.json();
   if(!controller.signal.aborted){setItems(data.samples.filter((sample:Preview)=>sample.approval_scope==="sample_only"&&sample.approved_at));setError(false);}
  }).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>controller.abort();
 },[refresh,version]);
 return <section className="panel studio-feature" aria-label="Prévias aprovadas">
  <div className="studio-actions"><h2>Prévias aprovadas</h2><button className="button" aria-label="Atualizar prévias" title="Atualizar prévias" onClick={()=>setVersion(value=>value+1)}><RefreshCw size={16}/></button></div>
  {error&&<p role="alert">Não foi possível consultar as prévias aprovadas.</p>}
  {items===null&&!error&&<p role="status">Consultando prévias…</p>}
  {items?.length===0&&<p>Nenhuma prévia com aprovação registrada.</p>}
  <div className="approved-preview-grid">{items?.map(item=><article key={item.id}>
   <video controls playsInline preload="none" width={240} aria-label={item.title} src={`/api/stories/styles/media?id=${item.id}`}/>
   <h3>{item.title}</h3><p>{item.source==="puter"?"Puter":item.source} · {item.seconds}s · {item.width} × {item.height} · {item.output_fps} FPS</p>
   <p>Amostra aprovada em {new Date(item.approved_at).toLocaleDateString("pt-BR")}. Aprovação limitada a esta prévia.</p>
    <details><summary>Limites desta aprovação</summary><ul>{item.limitations.map((limitation,index)=><li key={index}>{limitation}</li>)}</ul></details>
  </article>)}</div>
 </section>;
}