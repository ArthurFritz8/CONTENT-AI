"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Discovery } from "./discovery";
import { storyArtwork } from "../../../packages/core/src/stories/art";
import { storyKinds, type SeriesBible } from "../../../packages/core/src/stories/schema";
type Chapter = { number: number; idea_id: string; revision: number; idea_status: string; episode_id: string | null; status: string | null; approved: boolean };
type Series = { id: string; bible: SeriesBible; chapters: Chapter[] };
type Overview = { series: Series[]; remaining: number; daily_cap: number; generated_today: number; active: number; proposals_remaining: number; capacity: { unavailable?: boolean } };
const genres = { comedy: "Comédia", mystery: "Mistério", drama: "Drama leve", adventure: "Aventura" };
const progress: Record<string,string> = { idea: "Preparando capítulo", research: "Conferindo continuidade", script: "Criando roteiro e ilustrações", assets: "Renderizando vídeo", rendered: "Conferindo qualidade", review: "Pronto para revisão", failed: "Geração interrompida — veja os detalhes", published: "Publicado", analyze: "Publicado" };

export function StoryDiscovery({ onSaved, refresh }: { onSaved: () => void; refresh: number }) {
  const [kind,setKind] = useState<"factual" | "original" | "fruits">("factual");
  const [premise,setPremise] = useState(""), [genre,setGenre] = useState("comedy"), [chapters,setChapters] = useState(3);
  const [data,setData] = useState<Overview | null>(null), [error,setError] = useState(""), [notice,setNotice] = useState(""), [busy,setBusy] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const [version,setVersion] = useState(0);
  useEffect(() => {
    if (kind === "factual") return;
    const controller = new AbortController();
    async function load() {
      try {
        const r = await fetch("/api/stories", { signal: controller.signal });
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!controller.signal.aborted) setData(d);
      } catch(e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Histórias indisponíveis."); }
    }
    void load(); const timer = setInterval(() => void load(),30000);
    return () => { controller.abort(); clearInterval(timer); };
  },[kind,version,refresh]);
  function requestId(key: string) {
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    return request.current.id;
  }
  async function jsonPost(path: string, payload: unknown) {
    const r = await fetch(path,{ method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload) });
    const d = await r.json(); if (!r.ok) throw Error(d.error || "A operação não foi concluída."); return d;
  }
  async function propose() {
    setBusy(true);setError("");setNotice("");
    try {
      const input = { kind, genre, chapters, premise }, key = JSON.stringify(input);
      await jsonPost("/api/stories",{ action:"propose",input,requestId:requestId(key) });
      request.current=null;setVersion(v=>v+1);setNotice("Proposta criada. Confira os personagens e capítulos abaixo antes de gerar.");
    } catch(e) { setError(e instanceof Error ? e.message : "Não foi possível criar a proposta."); }
    finally { setBusy(false); }
  }
  async function next(s: Series) {
    setBusy(true);setError("");setNotice("");
    try {
      const d = await jsonPost("/api/stories",{action:s.chapters.at(-1)?.status==="failed" ? "retry" : "next",seriesId:s.id});
      const messages: Record<string,string> = { review_required:"Revise e aprove o capítulo anterior antes de continuar.", completed:"Esta história chegou ao fim. Crie uma nova proposta para outra série.", chapter_cancelled:"O capítulo foi cancelado. Crie uma nova proposta para recomeçar.", queue_full:"Sua fila está cheia.", daily_limit:"Limite de novas pautas de hoje atingido." };
      if (d.code !== "queued") throw Error(messages[d.code] || "Não foi possível preparar o capítulo.");
      const r = await fetch("/api/stories"), updated: Overview = await r.json();
      if (!r.ok) throw Error("O capítulo está na fila. Atualize a página para gerar.");
      setData(updated);
      const chapter = updated.series.find(v=>v.id===s.id)?.chapters.find(v=>v.idea_id===d.idea_id);
      if (!chapter) throw Error("Capítulo preparado. Atualize a página para gerar.");
      await jsonPost("/api/control",{action:"generate_video",payload:{id:chapter.idea_id,revision:chapter.revision},requestId:requestId(`generate:${chapter.idea_id}:${chapter.revision}`)});
      request.current=null;setNotice(`Capítulo ${chapter.number} em produção. O vídeo aparecerá aqui para revisão quando estiver pronto.`);onSaved();setVersion(v=>v+1);
    } catch(e) { setError(e instanceof Error ? e.message : "Não foi possível gerar.");onSaved();setVersion(v=>v+1); }
    finally { setBusy(false); }
  }
  return <>
    <section className="panel studio-feature" aria-label="Tipo de conteúdo">
      <h2>O que você quer criar?</h2>
      <div className="content-type-options">
        {([ ["factual","Vídeo de assunto","Gadgets, geek e outros temas com fontes."], ["original","História original","Elenco próprio e capítulos conectados."], ["fruits","Novela de frutas","Personagens-fruta e um enredo original."] ] as const).map(([id,label,description]) =>
          <button key={id} className={`content-type-card ${kind===id ? "selected" : ""}`} aria-pressed={kind===id} onClick={()=>{setKind(id);setError("");setNotice("");}}>
            <strong>{label}</strong><span>{description}</span><small>{id==="factual" ? "Consumo variável conforme a pesquisa" : "Ilustrado · sem custo de geração de imagens"}</small>
          </button>)}
      </div>
    </section>
    {kind === "factual" ? <Discovery onSaved={onSaved}/> : <>
      <section className="panel studio-feature">
        <h2>{storyKinds[kind]}</h2>
        <p>Crie a proposta, confira o elenco e gere um capítulo por vez. Vídeos ilustrados de pelo menos 60 segundos, com narração e legendas.</p>
        <div className="story-capacity" role="status">
          {data ? <><strong>{data.capacity.unavailable ? "Capacidade indisponível" : `Até ${data.remaining} vídeo${data.remaining===1 ? "" : "s"} estimado${data.remaining===1 ? "" : "s"} hoje`}</strong>
            <span>{data.generated_today}/{data.daily_cap} do limite diário utilizado{data.active ? " · há uma geração em andamento" : ""}. Propostas restantes: {data.proposals_remaining}/3.</span></> : "Consultando disponibilidade…"}
        </div>
        <p className="muted">Estimativa compartilhada entre os formatos; pode variar com as cotas gratuitas e correções do roteiro. Contadores do Studio renovam à 0h UTC (21h em Brasília).</p>
        <div className="studio-form-grid">
          <label>Tom da história<select value={genre} onChange={e=>setGenre(e.target.value)}>{Object.entries(genres).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          <label>Quantidade de capítulos<select value={chapters} onChange={e=>setChapters(Number(e.target.value))}>{[1,3,6].map(n=><option key={n} value={n}>{n===1 ? "1 — história independente" : `${n} — minissérie`}</option>)}</select></label>
        </div>
        <label>Sua ideia<textarea rows={3} maxLength={1000} value={premise} onChange={e=>setPremise(e.target.value)} placeholder={kind==="fruits" ? "Uma maçã e uma laranja disputam a barraca da feira, mas encontram um segredo que muda a amizade…" : "Dois vizinhos encontram uma carta antiga e precisam decidir quem vai descobrir seu segredo…"}/></label>
        <p className="muted">30–1.000 caracteres. A proposta apresenta o elenco e o enredo; ainda não gera vídeo.</p>
        <div className="studio-actions"><button className="button primary" disabled={busy || premise.trim().length<30 || data?.proposals_remaining===0} onClick={()=>void propose()}>{busy ? "Preparando…" : "Criar proposta"}</button><span className="muted">Formato: ilustrações originais. Cenas animadas aguardam disponibilidade de um provedor.</span></div>
        {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
      </section>
      <section className="story-series" aria-label="Suas histórias">
        {(data?.series ?? []).filter(s=>s.bible.kind===kind).map(s=>{
          const last = s.chapters.at(-1), finished = !!last?.approved && last.number>=s.bible.chapters.length;
          const pending = last?.idea_status==="pending", retry = last?.status==="failed", waiting = !!last && !pending && !last.approved && !retry;
          const cancelled = last?.idea_status==="rejected";
          const context = {series_id:s.id,bible:s.bible,chapter_number:1,previous_summaries:[]};
          const preview = storyArtwork(context,{speaker_id:s.bible.cast[0]!.id,on_stage:s.bible.cast.map(c=>c.id),setting:"garden",mood:"happy"},"portrait");
          return <article className="panel studio-feature" key={s.id}>
            <div className="story-proposal-layout"><img className="story-art-preview" src={`data:image/svg+xml,${encodeURIComponent(preview)}`} alt={`Prévia das ilustrações de ${s.bible.title}`} width={1080} height={1920}/>
            <div><h3>{s.bible.title}</h3><p>{s.bible.premise}</p>
              <h4>Elenco fixo</h4><div className="story-cast">{s.bible.cast.map(c=><div key={c.id}><strong><i style={{background:c.color}}/>{c.name}</strong><span>{c.personality}</span><small>{c.voice==="female" ? "Voz feminina" : "Voz masculina"}</small></div>)}</div>
              <details><summary>Ver plano dos {s.bible.chapters.length} capítulos</summary><ol>{s.bible.chapters.map((c,i)=><li key={i}><strong>{c.title}</strong><p>{c.arc}</p></li>)}</ol></details>
            </div></div>
            <div className="story-chapters">{s.chapters.map(c=><div key={c.number}><strong>Capítulo {c.number}</strong><span>{c.approved ? "Aprovado para continuidade" : c.idea_status==="rejected" ? "Cancelado" : c.idea_status==="pending" ? "Na fila — pronto para gerar" : progress[c.status ?? ""] || "Aguardando"}</span>{c.episode_id && <Link className="button small secondary" href={`/studio/episodes/${c.episode_id}`}>{c.status==="review" ? "Revisar vídeo" : "Ver geração"}</Link>}</div>)}</div>
            <div className="studio-actions"><button className="button primary" disabled={busy || waiting || finished || cancelled || !data || data.active>0 || data.remaining===0} onClick={()=>void next(s)}>{finished ? "História concluída" : cancelled ? "Capítulo cancelado" : waiting ? "Aguarde e revise o capítulo" : retry ? `Gerar capítulo ${last!.number} novamente` : !last || pending ? `Gerar capítulo ${last?.number ?? 1}` : `Continuar história · capítulo ${last.number+1}`}</button><p className="muted">{waiting ? "A continuação usa o resumo da versão aprovada. Abra a geração para revisar ou consultar uma falha." : "Só este capítulo será gerado. A publicação sempre depende da sua aprovação."}</p>
            {(!last || finished || retry || last.approved) && <button className="button secondary" disabled={busy} onClick={async()=>{
              setBusy(true);setError("");try { const d=await jsonPost("/api/stories",{action:"archive",seriesId:s.id});if(d.code!=="archived")throw Error("Conclua o capítulo pendente antes de arquivar.");setVersion(v=>v+1);setNotice("História arquivada. Seus vídeos permanecem em Gerações.");}catch(e){setError(e instanceof Error?e.message:"Não foi possível arquivar.");}finally{setBusy(false);}
            }}>Arquivar história</button>}</div>
          </article>;
        })}
        {data && !data.series.some(s=>s.bible.kind===kind) && <p className="muted">Sua primeira proposta aparecerá aqui com o elenco e o plano dos capítulos.</p>}
      </section>
    </>}
  </>;
}
