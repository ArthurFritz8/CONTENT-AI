"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Discovery } from "./discovery";
import { StoryProductionSetup } from "./story-production-setup";
import { storyArtwork } from "../../../packages/core/src/stories/art";
import { storyKinds, type SeriesBible } from "../../../packages/core/src/stories/schema";
type Chapter = { number: number; idea_id: string; revision: number; idea_status: string; episode_id: string | null; status: string | null; approved: boolean };
type Series = { id: string; bible: SeriesBible; chapters: Chapter[] };
type VideoWallet = { id: string; label: string; unit: string; remaining_units: number | null; reserved_units: number; available_units: number | null; checked_at: string | null; renews_at: string | null; balance_kind?: string; billing_may_lag?: boolean; source_ready?: boolean; balance_fresh?: boolean; source_blockers?: string[];
  minimum_chapter_estimate?: { shots: number; planned_seconds: number; required_units: number; shortfall_units: number | null; comparison_only: true } };
type Overview = { series: Series[]; remaining: number; daily_cap: number; generated_today: number; active: number; proposals_remaining: number; capacity: { unavailable?: boolean };
  animationProgress?: { chapters: Array<{ episode_id: string; completed_shots: number; total_shots: number; planned_seconds: number; output_fps: number; stage: string; prepared_audio?: number }>; unavailable?: boolean };
  videoCapacity?: { wallets: VideoWallet[]; series_profiles: Array<{ series_id: string; profile_sha256: string; compatible_wallets: string[] }>; unavailable?: boolean;
    preparation_enabled?: boolean; chapter_quotes?: Array<{ episode_id:string; series_id:string; wallet_id:string; required_units:number; planned_seconds:number; can_reserve:boolean }> } };
function walletAmount(value: number | null, unit: string) {
  if (value === null) return "Não confirmado";
  if (unit === "usd_micro") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(value / 1_000_000);
  if (unit === "gpu_milliseconds") return `${(value / 60_000).toFixed(1)} minutos de GPU`;
  return `${value} créditos`;
}
const genres = { comedy: "Comédia", mystery: "Mistério", drama: "Drama leve", adventure: "Aventura" };
const progress: Record<string,string> = { idea: "Preparando capítulo", research: "Conferindo continuidade", script: "Criando roteiro e ilustrações", assets: "Renderizando vídeo", rendered: "Conferindo qualidade", review: "Pronto para revisão", failed: "Geração interrompida — veja os detalhes", published: "Publicado", analyze: "Publicado" };
const animationStages: Record<string,string> = { awaiting_capacity:"Aguardando saldo ou configuração da fonte", preparing_audio: "Preparando e medindo falas", awaiting_plan: "Conferindo orçamento e disponibilidade", generating_clips: "Animando cenas", reconciliation_required: "Conferindo resultado antes de continuar", ready_for_assembly: "Cenas prontas para montagem", assembling: "Montando capítulo", rendered: "Conferindo capítulo", review: "Pronto para revisão", published: "Publicado", analyze: "Publicado", failed: "Geração interrompida" };
const sourceBlockers: Record<string,string> = {
  source_disabled: "Fonte ainda não ativada para geração.", balance_stale: "O saldo precisa de uma nova consulta; o valor exibido é da última verificação.",
  runtime_unverified: "A integração de animação ainda precisa ser implantada e validada.", entitlement_unverified: "A franquia gratuita precisa ser conferida novamente.",
  spend_limit_unverified: "Falta confirmar o limite de gastos de US$ 0 na conta.", billing_unverified: "Falta confirmar que não há cobranças em dinheiro neste período."
};

export function StoryDiscovery({ onSaved, refresh }: { onSaved: () => void; refresh: number }) {
  const [kind,setKind] = useState<"factual" | "original" | "fruits">("factual");
  const [premise,setPremise] = useState(""), [genre,setGenre] = useState("comedy"), [chapters,setChapters] = useState(3);
  const [creationMode,setCreationMode] = useState<"manual" | "automatic">("manual");
  const [data,setData] = useState<Overview | null>(null), [error,setError] = useState(""), [notice,setNotice] = useState(""), [busy,setBusy] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const [version,setVersion] = useState(0);
  const [balanceBusy,setBalanceBusy] = useState<string | null>(null);
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
      const input = { kind, genre, chapters, premise, creation_mode: creationMode }, key = JSON.stringify(input);
      await jsonPost("/api/stories",{ action:"propose",input,requestId:requestId(key) });
      request.current=null;setVersion(v=>v+1);setNotice("Proposta criada. Confira os personagens e capítulos abaixo antes de gerar.");
    } catch(e) { setError(e instanceof Error ? e.message : "Não foi possível criar a proposta."); }
    finally { setBusy(false); }
  }
  async function refreshBalance(walletId: string) {
    setBalanceBusy(walletId);setError("");setNotice("");
    try {
      const result=await jsonPost("/api/stories",{action:"balance",walletId});
      if(result.code==="entitlement_unverified")throw Error("O administrador precisa conferir a franquia gratuita desta conta antes da próxima consulta.");
      if(!["dispatch","waiting"].includes(result.code))throw Error("Não foi possível solicitar a consulta de saldo.");
      setNotice(result.code==="waiting" ? "Uma consulta foi solicitada recentemente. Aguarde até dois minutos; o painel atualiza o resultado automaticamente." : "Consulta de saldo solicitada. O resultado aparecerá automaticamente quando estiver pronto. Nenhum vídeo será gerado.");
      setVersion(v=>v+1);
    } catch(e) {setError(e instanceof Error ? e.message : "Saldo indisponível.");}
    finally {setBalanceBusy(null);}
  }
  async function next(s: Series) {
    setBusy(true);setError("");setNotice("");
    try {
      const d = await jsonPost("/api/stories",{action:s.chapters.at(-1)?.status==="failed" ? "retry" : "next",seriesId:s.id});
      const messages: Record<string,string> = { profile_incomplete:"Conclua a configuração das imagens e vozes antes de gerar o primeiro capítulo.", existing_video_work:"Este capítulo já tem cenas reservadas. Abra a geração para conferir e retomar o trabalho existente.", animation_setup_required:"A criação automática das tomadas desta novela está em preparação. Seu padrão animado foi preservado.", review_required:"Revise e aprove o capítulo anterior antes de continuar.", completed:"Esta história chegou ao fim. Crie uma nova proposta para outra série.", chapter_cancelled:"O capítulo foi cancelado. Crie uma nova proposta para recomeçar.", queue_full:"Sua fila está cheia.", daily_limit:"Limite de novas pautas de hoje atingido." };
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
            <strong>{label}</strong><span>{description}</span><small>{id==="factual" ? "Consumo variável conforme a pesquisa" : "Novela ilustrada ou animada com padrão aprovado"}</small>
          </button>)}
      </div>
    </section>
    {kind === "factual" ? <Discovery onSaved={onSaved}/> : <>
      <section className="panel studio-feature">
        <h2>{storyKinds[kind]}</h2>
        <p>Crie a proposta, confira o elenco e gere um capítulo por vez. Escolha o formato ilustrado ou configure imagens e vozes antes do primeiro capítulo para usar animação.</p>
        <div className="story-capacity" role="status">
          {data ? <><strong>{data.capacity.unavailable ? "Capacidade de roteiros indisponível" : `Até ${data.remaining} roteiro${data.remaining===1 ? "" : "s"} estimado${data.remaining===1 ? "" : "s"} hoje`}</strong>
            <span>{data.generated_today}/{data.daily_cap} do limite diário utilizado{data.active ? " · há uma geração em andamento" : ""}. Propostas restantes: {data.proposals_remaining}/3.</span></> : "Consultando disponibilidade…"}
        </div>
        <p className="muted">Esta estimativa é de roteiros e do limite diário do Studio. A capacidade de animação depende de saldo e fontes compatíveis com sua novela. Contadores do Studio renovam à 0h UTC (21h em Brasília).</p>
        <details><summary>Fontes e saldo para animação</summary>
          {!data?.videoCapacity?.wallets.length ? <p>Saldo de animação ainda não conectado ao Studio. A integração do Modal está em preparação.</p> : data.videoCapacity.wallets.map(w=><div key={w.id}>
            <p><strong>{w.label}</strong> · {w.balance_fresh===false ? "Último valor consultado" : w.balance_kind==="conservative_monthly_estimate" ? "Sobra estimada conservadora" : "Saldo"}: {walletAmount(w.remaining_units,w.unit)} · Reservado: {walletAmount(w.reserved_units,w.unit)} · Disponível para novos trabalhos: {walletAmount(w.available_units,w.unit)}</p>
            <p className="muted">{w.checked_at ? `Consultado em ${new Date(w.checked_at).toLocaleString("pt-BR")}. ` : "Consulta de saldo pendente. "}{w.renews_at ? `Renovação prevista: ${new Date(w.renews_at).toLocaleString("pt-BR")}.` : "Renovação ainda não confirmada."}</p>
            {w.balance_kind==="conservative_monthly_estimate" && <button className="button" disabled={!!balanceBusy} onClick={()=>void refreshBalance(w.id)}>{balanceBusy===w.id ? "Solicitando consulta…" : "Atualizar saldo"}</button>}
            {w.billing_may_lag && <p className="muted">O faturamento pode ter atraso. A estimativa desconta reservas e margem antes de liberar novos capítulos.{w.source_ready===false ? " Fonte aguardando configuração ou verificação; saldo exibido ainda não autoriza geração." : ""}</p>}
            {!!w.source_blockers?.length && <><strong>O que falta para liberar esta fonte</strong><ul>{w.source_blockers.map(code=><li key={code}>{sourceBlockers[code] || "Verificação da fonte pendente."}</li>)}</ul></>}
            {w.minimum_chapter_estimate && <p>Formato mínimo de {w.minimum_chapter_estimate.shots} tomadas / {w.minimum_chapter_estimate.planned_seconds.toLocaleString("pt-BR")}s: reserva estimada de {walletAmount(w.minimum_chapter_estimate.required_units,w.unit)}.
              {w.minimum_chapter_estimate.shortfall_units===null ? " Atualize a consulta para comparar com o saldo." : w.minimum_chapter_estimate.shortfall_units>0 ? ` Faltam ${walletAmount(w.minimum_chapter_estimate.shortfall_units,w.unit)} após reservas e margem.` : " O último saldo comporta essa estimativa mínima."}
              <small className="muted"> Comparação de orçamento. A quantidade de capítulos liberados depende do roteiro preparado e da aprovação da fonte para esta novela.</small></p>}
          </div>)}
          <p className="muted">Segundos e capítulos dependem do plano de cenas e da compatibilidade com o padrão da novela.</p>
        </details>
        <div className="content-type-options" aria-label="Como criar sua novela">
          <button className={`content-type-card ${creationMode==="manual" ? "selected" : ""}`} aria-pressed={creationMode==="manual"} disabled={busy} onClick={()=>setCreationMode("manual")}><strong>Criar com minha ideia</strong><span>Descreva a história que você quer desenvolver.</span></button>
          <button className={`content-type-card ${creationMode==="automatic" ? "selected" : ""}`} aria-pressed={creationMode==="automatic"} disabled={busy} onClick={()=>setCreationMode("automatic")}><strong>Criar novela automaticamente</strong><span>O sistema cria sinopse, personagens, relações e arco da história.</span></button>
        </div>
        <div className="studio-form-grid">
          <label>Tom da história<select value={genre} onChange={e=>setGenre(e.target.value)}>{Object.entries(genres).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          <label>Quantidade de capítulos<select value={chapters} onChange={e=>setChapters(Number(e.target.value))}>{[1,3,6].map(n=><option key={n} value={n}>{n===1 ? "1 — história independente" : `${n} — minissérie`}</option>)}</select></label>
        </div>
        <label>{creationMode==="automatic" ? "Preferências (opcional)" : "Sua ideia"}<textarea rows={3} maxLength={1000} value={premise} onChange={e=>setPremise(e.target.value)} placeholder={creationMode==="automatic" ? "Pode deixar em branco ou sugerir: mistério na feira, amizade e uma grande revelação…" : kind==="fruits" ? "Uma maçã e uma laranja disputam a barraca da feira, mas encontram um segredo que muda a amizade…" : "Dois vizinhos encontram uma carta antiga e precisam decidir quem vai descobrir seu segredo…"}/></label>
        <p className="muted">{creationMode==="automatic" ? "Nenhuma ideia precisa ser preenchida. Pode usar até 1.000 caracteres para orientar a proposta." : "30–1.000 caracteres."} A proposta usa a cota de texto; ainda não gera vídeo.</p>
        <div className="studio-actions"><button className="button primary" disabled={busy || (creationMode==="manual" && premise.trim().length<30) || !data || data.proposals_remaining===0} onClick={()=>void propose()}>{busy ? "Preparando…" : creationMode==="automatic" ? "Criar novela automaticamente" : "Criar proposta"}</button><span className="muted">A proposta ainda não gera imagens nem vídeo. A animação exige referências aprovadas, uma fonte validada e saldo para o capítulo completo.</span></div>
        {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
      </section>
      <section className="story-series" aria-label="Suas histórias">
        {(data?.series ?? []).filter(s=>s.bible.kind===kind).map(s=>{
          const last = s.chapters.at(-1), finished = !!last?.approved && last.number>=s.bible.chapters.length;
          const pending = last?.idea_status==="pending", retry = last?.status==="failed", waiting = !!last && !pending && !last.approved && !retry;
          const cancelled = last?.idea_status==="rejected";
          const production = data?.videoCapacity?.series_profiles.find(p=>p.series_id===s.id);
          const context = {series_id:s.id,bible:s.bible,chapter_number:1,previous_summaries:[]};
          const preview = storyArtwork(context,{speaker_id:s.bible.cast[0]!.id,on_stage:s.bible.cast.map(c=>c.id),setting:"garden",mood:"happy"},"portrait");
          return <article className="panel studio-feature" key={s.id}>
            <div className={`story-proposal-layout ${production ? "story-proposal-animated" : ""}`}>{!production && <div><img className="story-art-preview" src={`data:image/svg+xml,${encodeURIComponent(preview)}`} alt={`Esboço do formato ilustrado de ${s.bible.title}`} width={1080} height={1920}/><small>Esboço do formato ilustrado</small></div>}
            <div><h3>{s.bible.title}</h3><p>{s.bible.premise}</p>
              <p className="muted">{production ? `${production.compatible_wallets.length} fonte(s) com compatibilidade registrada para esta novela. O saldo e a disponibilidade são conferidos antes de cada envio.` : "Padrão animado ainda não configurado. Os capítulos deste fluxo usam ilustrações."}</p>
              {(data?.videoCapacity?.chapter_quotes ?? []).filter(q=>q.series_id===s.id).map(q=><p key={`${q.episode_id}:${q.wallet_id}`} role="status">
                {data?.videoCapacity?.wallets.find(w=>w.id===q.wallet_id)?.label}: capítulo de {q.planned_seconds.toLocaleString("pt-BR")}s · reserva estimada {walletAmount(q.required_units,"usd_micro")} · {q.can_reserve ? "Cabe um capítulo completo neste orçamento" : "Capítulo ainda sem orçamento disponível"}.
              </p>)}
              {s.bible.world && <p><strong>Universo:</strong> {s.bible.world}</p>}
              {s.bible.central_conflict && <p><strong>Conflito:</strong> {s.bible.central_conflict}</p>}
              <h4>Elenco fixo</h4><div className="story-cast">{s.bible.cast.map(c=><div key={c.id}><strong><i style={{background:c.color}}/>{c.name}</strong><span>{c.personality}</span>{c.goal && <span>Objetivo: {c.goal}</span>}{c.appearance_description && <small>{c.appearance_description}</small>}<small>{c.voice==="female" ? "Voz feminina" : "Voz masculina"}</small></div>)}</div>
              {!!s.bible.relationships?.length && <details><summary>Relações entre os personagens</summary>{s.bible.relationships.map((r,i)=><p key={i}><strong>{s.bible.cast.find(c=>c.id===r.from)?.name} e {s.bible.cast.find(c=>c.id===r.to)?.name}:</strong> {r.description}</p>)}</details>}
              {s.bible.ending && <details><summary>Desfecho planejado (contém spoilers)</summary><p>{s.bible.ending}</p></details>}
              <details><summary>Ver plano dos {s.bible.chapters.length} capítulos</summary><ol>{s.bible.chapters.map((c,i)=><li key={i}><strong>{c.title}</strong><p>{c.arc}</p></li>)}</ol></details>
            </div></div>
            <StoryProductionSetup seriesId={s.id} onSaved={()=>{setVersion(v=>v+1);onSaved();}}/>
            <div className="story-chapters">{s.chapters.map(c=>{
              const animated = data?.animationProgress?.chapters.find(p=>p.episode_id===c.episode_id);
              return <div key={c.number}><strong>Capítulo {c.number}</strong><span>{c.approved ? "Aprovado para continuidade" : animated ? animationStages[animated.stage] || "Conferindo geração" : c.idea_status==="rejected" ? "Cancelado" : c.idea_status==="pending" ? "Na fila — pronto para gerar" : progress[c.status ?? ""] || "Aguardando"}</span>
                {animated && <small>{animated.completed_shots}/{animated.total_shots} cenas concluídas · {animated.planned_seconds.toLocaleString("pt-BR")}s planejados · saída de {animated.output_fps} FPS</small>}
                {animated?.prepared_audio !== undefined && <small>{animated.prepared_audio}/{animated.total_shots} falas preparadas e medidas</small>}
                {c.episode_id && <Link className="button small secondary" href={`/studio/episodes/${c.episode_id}`}>{c.status==="review" ? "Revisar vídeo" : "Ver geração"}</Link>}</div>;
            })}</div>
            <div className="studio-actions"><button className="button primary" disabled={busy || (!!production && !data?.videoCapacity?.preparation_enabled) || waiting || finished || cancelled || !data || data.active>0 || data.remaining===0} onClick={()=>void next(s)}>{finished ? "História concluída" : cancelled ? "Capítulo cancelado" : waiting ? "Aguarde e revise o capítulo" : production && !data?.videoCapacity?.preparation_enabled ? "Ativação da criação animada pendente" : retry ? `Gerar capítulo ${last!.number} novamente` : !last || pending ? `Gerar capítulo ${last?.number ?? 1}` : `Continuar história · capítulo ${last.number+1}`}</button><p className="muted">{waiting ? "A continuação usa o resumo da versão aprovada. Abra a geração para revisar ou consultar uma falha." : production ? "As falas são preparadas primeiro. A animação aguarda orçamento para o capítulo completo. A publicação depende da sua aprovação." : "Só este capítulo será gerado. A publicação sempre depende da sua aprovação."}</p>
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
