"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Discovery } from "./discovery";
import { StoryProductionSetup } from "./story-production-setup";
import {StoryNativeSetup} from "./story-native-setup";
import {StoryDuration} from "./story-duration";
import {StoryEditorial} from "./story-editorial";
import {StoryReferenceSource} from "./story-reference-source";
import {StoryStyleSelector} from "./story-style-selector";
import {StoryPresentationSettings,type PresentationVersion} from "./story-presentation-settings";
import {defaultStoryPresentation,presentationNeedsAdapter,supportsPreparedPattern,supportsNativePattern,storyStyles,type StoryStyleId} from "../../../packages/core/src/stories/styles";
import { storyArtwork } from "../../../packages/core/src/stories/art";
import { storyKinds, type SeriesBible } from "../../../packages/core/src/stories/schema";
type Chapter = { native_shots?:3|6|9; number: number; idea_id: string; revision: number; idea_status: string; episode_id: string | null; status: string | null; approved: boolean;style_id?:StoryStyleId|null;presentation_revision?:number|null };
type Series = { native_shots?:3|6|9; native_format_revision?:number; id: string; bible: SeriesBible; chapters: Chapter[];presentation?:PresentationVersion|null;presentation_history?:PresentationVersion[] };
type VideoWallet = { id: string; label: string; unit: string; remaining_units: number | null; reserved_units: number; available_units: number | null; checked_at: string | null; renews_at: string | null; balance_kind?: string; billing_may_lag?: boolean; source_ready?: boolean; balance_fresh?: boolean; source_blockers?: string[];
  candidate?:boolean;monthly_allowance?:number|null;period?:string|null;sync_failed?:boolean;sync_running?:boolean;budget_only_shots?:number|null;
  native_enabled?:boolean;native_budget_chapters?:number|null;
  jobs?:Array<{id:string;label:string;status:string;settled:boolean;charged_credits:number;ready:boolean;observed_at:string|null}>;
  minimum_chapter_estimate?: { shots: number; planned_seconds: number; required_units: number; shortfall_units: number | null; comparison_only: true } };
type Overview = { series: Series[]; remaining: number; daily_cap: number; generated_today: number; active: number; proposals_remaining: number; capacity: { unavailable?: boolean };
  animationProgress?: { chapters: Array<{ episode_id: string; completed_shots: number; total_shots: number; planned_seconds: number; output_fps: number; stage: string; prepared_audio?: number }>; unavailable?: boolean };
  videoCapacity?: { wallets: VideoWallet[]; series_profiles: Array<{ series_id: string; profile_sha256: string; compatible_wallets: string[] }>; unavailable?: boolean;
    native_enabled?:boolean;native_chapters?:Array<{episode_id:string;completed_shots:number;total_shots:number;planned_seconds:number;output_fps:number;stage:string;last_code:string|null;cancel_requested:boolean;closed:boolean}>;
    patterns?:Array<{series_id:string;revision:number;style_id:StoryStyleId;profile_sha256:string}>;
    preparation_enabled?: boolean; chapter_quotes?: Array<{ episode_id:string; series_id:string; wallet_id:string; required_units:number; planned_seconds:number; can_reserve:boolean }> } };
function walletAmount(value: number | null, unit: string) {
  if (value === null) return "Não confirmado";
  if (unit === "usd_micro") return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(value / 1_000_000);
  if (unit === "gpu_milliseconds") return `${(value / 60_000).toFixed(1)} minutos de GPU`;
  return `${value} créditos`;
}
const genres = { comedy: "Comédia", mystery: "Mistério", drama: "Drama leve", adventure: "Aventura" };
const progress: Record<string,string> = { idea: "Preparando capítulo", research: "Conferindo continuidade", script: "Criando roteiro e ilustrações", assets: "Renderizando vídeo", rendered: "Conferindo qualidade", review: "Pronto para revisão", failed: "Geração interrompida — veja os detalhes", published: "Publicado", analyze: "Publicado" };
const animationStages: Record<string,string> = { awaiting_capacity:"Aguardando saldo ou configuração da fonte", preparing_audio: "Preparando e medindo falas", awaiting_plan: "Conferindo orçamento e disponibilidade", generating_clips: "Animando cenas", reconciliation_required: "Conferindo resultado antes de continuar", ready_for_assembly: "Cenas prontas para montagem", assembling: "Montando capítulo", rendered: "Conferindo capítulo", review: "Pronto para revisão", cancellation_pending:"Encerrando envios e conferindo cobranças",cancelled:"Tentativa encerrada", published: "Publicado", analyze: "Publicado", failed: "Geração interrompida" };
const sourceBlockers: Record<string,string> = {
  source_disabled: "Fonte ainda não ativada para geração.", balance_stale: "O saldo precisa de uma nova consulta; o valor exibido é da última verificação.",
  runtime_unverified: "A integração de animação ainda precisa ser implantada e validada.", entitlement_unverified: "A franquia gratuita precisa ser conferida novamente.",
  spend_limit_unverified: "Falta confirmar o limite de gastos de US$ 0 na conta.", billing_unverified: "Falta confirmar que não há cobranças em dinheiro neste período.",
  continuity_unverified:"A aparência e a roupa dos personagens ainda precisam permanecer estáveis durante todas as cenas.",
  voice_identity_unverified:"A voz de cada personagem ainda precisa ser validada entre cenas e capítulos.",
  production_adapter_pending:"A geração de capítulos por esta fonte ainda está em integração.",
  insufficient_free_credits:"A franquia gratuita não comporta outra tomada de cinco segundos.",
  mixed_or_promotional_wallet:"A carteira não foi confirmada como exclusivamente gratuita e recorrente.",
  non_base_free_account:"Esta conexão exige o plano Free, sem assinatura paga ou promoção.",
  stale_credit_period:"O período dos créditos precisa ser atualizado pelo serviço.",
  missing_scopes:"As permissões da chave precisam ser conferidas pelo administrador.",
  bounded_free_key_cap_required:"O teto da chave precisa ser finito e limitado à franquia gratuita.",
  price_changed:"O preço mudou e precisa ser validado antes de qualquer nova geração.",
  email_unverified:"Confirme o e-mail na conta Auray.",free_video_unavailable:"Vídeo indisponível na franquia gratuita consultada.",
  recurring_free_unverified:"A franquia mensal gratuita precisa ser conferida.",wallet_unverified:"O serviço não confirmou todos os valores da carteira."
};
const candidateJobStatus:Record<string,string>={unknown:"Verificando envio anterior",queued:"Na fila",running:"Gerando",succeeded:"Geração concluída",failed:"Geração falhou",cancelled:"Cancelado"};
const nativeMessages:Record<string,string>={complete_chapter_budget_required:"O saldo confirmado não comporta a reserva desta tentativa. Aguarde a renovação ou atualize o saldo antes de retomar.",wallet_reserved:"Esta carteira já está reservada para outro capítulo. Ele precisa terminar ou ser conciliado primeiro.",native_financial_gate_closed:"O saldo ou a conexão precisa de nova verificação antes de enviar outra tomada.",native_job_failed_no_retry:"Uma tomada falhou. Nenhuma substituição será cobrada automaticamente. Encerre e concilie esta tentativa antes de gerar outra.",native_worker_unavailable:"A execução foi interrompida. Retomar confere os mesmos trabalhos e preserva as tomadas já salvas.",rate_limited:"A fonte pediu uma pausa. O acompanhamento respeita o prazo antes de consultar novamente.",native_media_contract_changed:"A fonte devolveu um arquivo fora do padrão de resolução ou quadros. O sistema preservou o envio e não reduziu a qualidade para montar."};

export function StoryDiscovery({ onSaved, refresh }: { onSaved: () => void; refresh: number }) {
  const [kind,setKind] = useState<"factual" | "original" | "fruits">("factual");
  const [premise,setPremise] = useState(""), [genre,setGenre] = useState("comedy"), [chapters,setChapters] = useState(3);
  const [nativeShots,setNativeShots]=useState<3|6|9>(3);
  const [creationMode,setCreationMode] = useState<"manual" | "automatic">("manual");
  const [presentation,setPresentation]=useState(defaultStoryPresentation);
  const [chapterStyles,setChapterStyles]=useState<Record<string,StoryStyleId>>({});
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
      const input = { kind, genre, chapters, premise, creation_mode: creationMode,presentation,...(presentation.source==="auray"?{native_shots:nativeShots}:{}) }, key = JSON.stringify(input);
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
      const d = await jsonPost("/api/stories",{action:s.chapters.at(-1)?.status==="failed" ? "retry" : "next",seriesId:s.id,...(s.presentation ? {styleId:chapterStyles[s.id] && s.presentation.preferences.allowed_styles.includes(chapterStyles[s.id]!) ? chapterStyles[s.id] : s.presentation.preferences.primary_style} : {})});
      const messages: Record<string,string> = { native_setup_required:"A conexão Auray aguarda ativação. O padrão salvo foi preservado.",native_voice_consent_required:"Confira o exemplo e aceite as vozes nativas antes de gerar.",existing_native_work:"Este capítulo já tem trabalho nativo. Use Retomar acompanhamento; não será criada outra tentativa.",style_preparation_required:"A proposta foi preservada. Os capítulos deste estilo ou fonte ainda estão em preparação; sua escolha não será substituída por ilustrações.",style_preferences_required:"Salve as preferências visuais antes de escolher um estilo para o capítulo.",existing_chapter_style:"Este capítulo já foi preparado com outra escolha. Retome o trabalho existente.",profile_incomplete:"Conclua a configuração das imagens e vozes antes de gerar o primeiro capítulo.", existing_video_work:"Este capítulo já tem cenas reservadas. Abra a geração para conferir e retomar o trabalho existente.", animation_setup_required:"A criação automática das tomadas desta novela está em preparação. Seu padrão animado foi preservado.", review_required:"Revise e aprove o capítulo anterior antes de continuar.", completed:"Esta história chegou ao fim. Crie uma nova proposta para outra série.", chapter_cancelled:"O capítulo foi cancelado. Crie uma nova proposta para recomeçar.", queue_full:"Sua fila está cheia.", daily_limit:"Limite de novas pautas de hoje atingido." };
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
  async function nativeAction(episodeId:string,operation:"resume"|"cancel") {
    if(operation==="cancel"&&!window.confirm("Encerrar esta tentativa? Isso impede novas tomadas. Envios já aceitos ainda podem consumir créditos e serão conciliados antes de liberar a reserva."))return;
    setBusy(true);setError("");setNotice("");
    try{const r=await jsonPost("/api/stories",{action:"native",episodeId,operation});setNotice(r.code==="cancelled"?"Tentativa encerrada. Nenhuma nova tomada será enviada.":r.code==="waiting_for_runner"?"O trabalho já está sendo acompanhado. A tela atualiza automaticamente.":"Solicitação recebida. Serão consultados os mesmos envios, sem gerar tomadas repetidas.");setVersion(v=>v+1);onSaved();}
    catch(e){setError(e instanceof Error?e.message:"Não foi possível retomar.");}finally{setBusy(false);}
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
            <p><strong>{w.label}</strong> · {w.balance_fresh===false || w.sync_failed ? "Último valor consultado" : w.balance_kind==="conservative_monthly_estimate" ? "Sobra estimada conservadora" : "Saldo"}: {walletAmount(w.remaining_units,w.unit)} · Reservado: {walletAmount(w.reserved_units,w.unit)} · Disponível para novos trabalhos: {w.native_enabled ? (w.native_budget_chapters==null ? "Atualize o saldo" : `${w.native_budget_chapters} capítulo(s) de 15s, por orçamento`) : w.candidate ? "Aguardando validação" : walletAmount(w.available_units,w.unit)}</p>
            <p className="muted">{w.checked_at ? `Consultado em ${new Date(w.checked_at).toLocaleString("pt-BR")}. ` : "Consulta de saldo pendente. "}{w.renews_at ? `Renovação prevista: ${new Date(w.renews_at).toLocaleString("pt-BR")}.` : "Renovação ainda não confirmada."}</p>
            {["conservative_monthly_estimate","verified_free_credits"].includes(w.balance_kind || "") && <button className="button" disabled={!!balanceBusy || w.sync_running} onClick={()=>void refreshBalance(w.id)}>{balanceBusy===w.id ? "Solicitando consulta…" : w.sync_running ? "Consultando…" : w.candidate ? "Atualizar saldo e testes existentes" : "Atualizar saldo"}</button>}
            {w.candidate && <>
              <p className="muted">Franquia mensal: {w.monthly_allowance==null ? "não confirmada" : `${w.monthly_allowance} créditos gratuitos`}{w.period ? ` · período ${w.period}` : ""}. {w.native_enabled ? "Diálogo nativo disponível com aceite de vozes variáveis e revisão." : "Esta fonte ainda está em avaliação para capítulos."}</p>
              {w.sync_failed && <p role="status">A última consulta não terminou. O saldo anterior foi preservado como histórico. Tente atualizar novamente; os mesmos trabalhos serão consultados.</p>}
              {w.native_enabled && <p>Referência de capacidade: capítulo Auray de 15s, com três tomadas e custo de 15 créditos gratuitos. Para 30 ou 45s, confira a capacidade na própria novela. {w.native_budget_chapters==null?"Atualize o saldo para consultar o orçamento.":`O último saldo, após reservas, comporta até ${w.native_budget_chapters} capítulo(s), sem margem para novas tentativas.`} Esta capacidade não é somada ao Modal. Cada capítulo exige revisão.</p>}
              {w.budget_only_shots!=null && !w.native_enabled && <p>Comparação de orçamento: até {w.budget_only_shots} tomada(s) de 5 segundos ({w.budget_only_shots*5} segundos brutos), a 5 créditos cada. Isso não inclui novas tentativas nem garante capítulos completos. Esse valor não é somado ao Modal.</p>}
              {!!w.jobs?.length && <details><summary>Testes e trabalhos existentes ({w.jobs.length})</summary><p className="muted">A retomada consulta o mesmo envio e recolhe o vídeo concluído. Não cria outra geração. Prévias preservam o áudio e os quadros originais; não certificam continuidade.</p>
                {w.jobs.map(j=><div key={j.id}><p><strong>{j.label}</strong> · {j.ready ? "Teste disponível para revisão" : candidateJobStatus[j.status] || "Consulta pendente"} · {j.charged_credits} créditos{!j.settled ? " (cobrança ainda não liquidada)" : ""}</p>
                  {j.ready && <video controls playsInline preload="none" width={240} aria-label={`Teste Auray de ${j.label}`} src={`/api/stories/auray/media?id=${j.id}`}/>}
                </div>)}
              </details>}
            </>}
            {w.billing_may_lag && <p className="muted">O faturamento pode ter atraso. A estimativa desconta reservas e margem antes de liberar novos capítulos.{w.source_ready===false ? " Fonte aguardando configuração ou verificação; saldo exibido ainda não autoriza geração." : ""}</p>}
            {!!w.source_blockers?.length && <><strong>{w.native_enabled?"Limitações e verificações da fonte":"O que falta para liberar esta fonte"}</strong><ul>{w.source_blockers.map(code=><li key={code}>{sourceBlockers[code] || "Verificação da fonte pendente."}</li>)}</ul></>}
            {w.minimum_chapter_estimate && <p>Formato mínimo de {w.minimum_chapter_estimate.shots} tomadas / {w.minimum_chapter_estimate.planned_seconds.toLocaleString("pt-BR")}s: reserva estimada de {walletAmount(w.minimum_chapter_estimate.required_units,w.unit)}.
              {w.minimum_chapter_estimate.shortfall_units===null ? " Atualize a consulta para comparar com o saldo." : w.minimum_chapter_estimate.shortfall_units>0 ? ` Faltam ${walletAmount(w.minimum_chapter_estimate.shortfall_units,w.unit)} após reservas e margem.` : " O último saldo comporta essa estimativa mínima."}
              <small className="muted"> Comparação de orçamento. A quantidade de capítulos liberados depende do roteiro preparado e da aprovação da fonte para esta novela.</small></p>}
          </div>)}
          <p className="muted">Segundos e capítulos dependem do plano de cenas e da compatibilidade com o padrão da novela.</p>
        </details>
        <StoryStyleSelector value={presentation} onChange={setPresentation} disabled={busy}/>
        <div className="content-type-options" aria-label="Como criar sua novela">
          <button className={`content-type-card ${creationMode==="manual" ? "selected" : ""}`} aria-pressed={creationMode==="manual"} disabled={busy} onClick={()=>setCreationMode("manual")}><strong>Criar com minha ideia</strong><span>Descreva a história que você quer desenvolver.</span></button>
          <button className={`content-type-card ${creationMode==="automatic" ? "selected" : ""}`} aria-pressed={creationMode==="automatic"} disabled={busy} onClick={()=>setCreationMode("automatic")}><strong>Criar novela automaticamente</strong><span>O sistema cria sinopse, personagens, relações e arco da história.</span></button>
        </div>
        <div className="studio-form-grid">
          <label>Tom da história<select value={genre} onChange={e=>setGenre(e.target.value)}>{Object.entries(genres).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          {presentation.source==="auray"&&<label>Duração de cada capítulo<select value={nativeShots} onChange={e=>setNativeShots(Number(e.target.value) as 3|6|9)}>{[3,6,9].map(n=><option key={n} value={n}>Aproximadamente {n*5}s · {n} cenas · {n*5} créditos</option>)}</select></label>}
          <label>Quantidade de capítulos<select value={chapters} onChange={e=>setChapters(Number(e.target.value))}>{[1,3,6].map(n=><option key={n} value={n}>{n===1 ? "1 — história independente" : `${n} — minissérie`}</option>)}</select></label>
        </div>
        <label>{creationMode==="automatic" ? "Preferências (opcional)" : "Sua ideia"}<textarea rows={3} maxLength={1000} value={premise} onChange={e=>setPremise(e.target.value)} placeholder={creationMode==="automatic" ? "Pode deixar em branco ou sugerir: mistério na feira, amizade e uma grande revelação…" : kind==="fruits" ? "Uma maçã e uma laranja disputam a barraca da feira, mas encontram um segredo que muda a amizade…" : "Dois vizinhos encontram uma carta antiga e precisam decidir quem vai descobrir seu segredo…"}/></label>
        <p className="muted">{creationMode==="automatic" ? "Nenhuma ideia precisa ser preenchida. Pode usar até 1.000 caracteres para orientar a proposta." : "30–1.000 caracteres."} A proposta usa a cota de texto; ainda não gera vídeo.</p>
        <div className="studio-actions"><button className="button primary" disabled={busy || (creationMode==="manual" && premise.trim().length<30) || !data || data.proposals_remaining===0} onClick={()=>void propose()}>{busy ? "Preparando…" : creationMode==="automatic" ? "Criar novela automaticamente" : "Criar proposta"}</button><span className="muted">A proposta ainda não gera imagens nem vídeo. A animação exige referências aprovadas, uma fonte validada e saldo para o capítulo completo.</span></div>
        {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
      </section>
      <StoryReferenceSource/>
      <section className="story-series" aria-label="Suas histórias">
        {(data?.series ?? []).filter(s=>s.bible.kind===kind).map(s=>{
          const last = s.chapters.at(-1), finished = !!last?.approved && last.number>=s.bible.chapters.length;
          const pending = last?.idea_status==="pending", retry = last?.status==="failed", waiting = !!last && !pending && !last.approved && !retry;
          const cancelled = last?.idea_status==="rejected";
          const production = !s.presentation && data?.videoCapacity?.series_profiles.find(p=>p.series_id===s.id);
          const chosenStyle=s.presentation && chapterStyles[s.id] && s.presentation.preferences.allowed_styles.includes(chapterStyles[s.id]!) ? chapterStyles[s.id] : s.presentation?.preferences.primary_style;
          const pattern=s.presentation && data?.videoCapacity?.patterns?.find(p=>p.series_id===s.id && p.revision===s.presentation?.revision && p.style_id===chosenStyle);
          const native=s.presentation?.preferences.source==="auray";
          const shots=(pending||retry?last?.native_shots:s.native_shots)??3;
          const nativeCost=shots*5;
          const stylePending=!retry && !!s.presentation && (chosenStyle==="illustrated"?presentationNeedsAdapter(s.presentation.preferences,chosenStyle):!(supportsPreparedPattern(s.presentation.preferences,chosenStyle!)||supportsNativePattern(s.presentation.preferences,chosenStyle!)) || !pattern);
          const preparationPending=!!(production || pattern) && !(native?data?.videoCapacity?.native_enabled:data?.videoCapacity?.preparation_enabled);
          const illustrativePreview=!production && (!s.presentation || s.presentation.preferences.primary_style==="illustrated");
          const context = {series_id:s.id,bible:s.bible,chapter_number:1,previous_summaries:[]};
          const preview = storyArtwork(context,{speaker_id:s.bible.cast[0]!.id,on_stage:s.bible.cast.map(c=>c.id),setting:"garden",mood:"happy"},"portrait");
          return <article className="panel studio-feature" key={s.id}>
            <div className={`story-proposal-layout ${production || !illustrativePreview ? "story-proposal-animated" : ""}`}>{illustrativePreview && <div><img className="story-art-preview" src={`data:image/svg+xml,${encodeURIComponent(preview)}`} alt={`Esboço do formato ilustrado de ${s.bible.title}`} width={1080} height={1920}/><small>Esboço do formato ilustrado</small></div>}
            <div><h3>{s.bible.title}</h3><p>{s.bible.premise}</p>
              <p className="muted">{production ? `${production.compatible_wallets.length} fonte(s) com compatibilidade registrada para esta novela. O saldo e a disponibilidade são conferidos antes de cada envio.` : s.presentation ? `Estilo planejado: ${storyStyles.find(v=>v.id===s.presentation?.preferences.primary_style)?.label}. A produção depende da disponibilidade deste estilo e da fonte escolhida.` : "Padrão animado ainda não configurado. Os capítulos deste fluxo usam ilustrações."}</p>
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
            {!s.presentation && <StoryProductionSetup seriesId={s.id} onSaved={()=>setVersion(v=>v+1)}/>}
            {s.presentation?.preferences.allowed_styles.filter(id=>supportsPreparedPattern(s.presentation!.preferences,id)).map(id=><StoryProductionSetup key={`${s.presentation!.revision}:${id}`} seriesId={s.id} presentationRevision={s.presentation!.revision} styleId={id} onSaved={()=>setVersion(v=>v+1)}/>)}
            {s.presentation?.preferences.allowed_styles.filter(id=>supportsNativePattern(s.presentation!.preferences,id)).map(id=><StoryNativeSetup key={`native:${s.presentation!.revision}:${id}`} seriesId={s.id} revision={s.presentation!.revision} styleId={id} onSaved={()=>setVersion(v=>v+1)}/>)}
            {native&&s.presentation?.preferences.voice_policy==="preserve"&&<p role="status">A Auray gera vozes próprias. Para usar esta fonte, abra Estilo e fontes e escolha permitir versões de voz; depois confira o exemplo e confirme o padrão Auray.</p>}
            <StoryPresentationSettings seriesId={s.id} current={s.presentation ?? null} history={s.presentation_history ?? []} chapterActive={!!last && !last.approved} onSaved={()=>setVersion(v=>v+1)}/>
            {s.presentation?.preferences.continuity_mode==="per_chapter" && !last?.status?.includes("failed") && <label>Estilo para o próximo capítulo<select value={chapterStyles[s.id] && s.presentation.preferences.allowed_styles.includes(chapterStyles[s.id]!) ? chapterStyles[s.id] : s.presentation.preferences.primary_style} onChange={e=>setChapterStyles(v=>({...v,[s.id]:e.target.value as StoryStyleId}))}>{s.presentation.preferences.allowed_styles.map(id=><option key={id} value={id}>{storyStyles.find(v=>v.id===id)?.label}</option>)}</select></label>}
            {native&&<StoryDuration key={`${s.id}:${s.native_format_revision??0}`} seriesId={s.id} shots={s.native_shots??3} revision={s.native_format_revision??0} frozenShots={pending||waiting||retry?last?.native_shots??3:undefined} wallets={data?.videoCapacity?.wallets??[]} onSaved={()=>setVersion(v=>v+1)}/>}
            <StoryEditorial seriesId={s.id} onSaved={()=>setVersion(v=>v+1)}/>
            <div className="story-chapters">{s.chapters.map(c=>{
              const nativeProgress=data?.videoCapacity?.native_chapters?.find(p=>p.episode_id===c.episode_id);
              const animated = nativeProgress || data?.animationProgress?.chapters.find(p=>p.episode_id===c.episode_id);
              return <div key={c.number}><strong>Capítulo {c.number}</strong><span>{c.approved ? "Aprovado para continuidade" : animated ? animationStages[animated.stage] || "Conferindo geração" : c.idea_status==="rejected" ? "Cancelado" : c.idea_status==="pending" ? "Na fila — pronto para gerar" : progress[c.status ?? ""] || "Aguardando"}</span>
                {c.presentation_revision && <small>Estilo: {storyStyles.find(v=>v.id===c.style_id)?.label} · padrão versão {c.presentation_revision}</small>}
                {animated && <small>{animated.completed_shots}/{animated.total_shots} cenas concluídas · {animated.planned_seconds.toLocaleString("pt-BR")}s planejados · saída de {animated.output_fps} FPS</small>}
                {animated && "prepared_audio" in animated && animated.prepared_audio !== undefined && <small>{animated.prepared_audio}/{animated.total_shots} falas preparadas e medidas</small>}
                {nativeProgress?.last_code&&nativeMessages[nativeProgress.last_code]&&<p role="status">{nativeMessages[nativeProgress.last_code]}</p>}
                {nativeProgress&&!nativeProgress.closed&&c.status==="research"&&<><p className="muted">{nativeProgress.cancel_requested?"Encerrando: nenhuma nova tomada será enviada. Aguardando a confirmação dos envios e cobranças existentes.":nativeProgress.stage==="reconciliation_required"?"Um envio precisa de conferência. Retomar consulta o mesmo trabalho; não cria outra tomada.":nativeProgress.stage==="awaiting_capacity"?"Conferindo a franquia gratuita para as tomadas desta tentativa. As cenas já salvas serão preservadas.":"As cenas são geradas uma de cada vez. O áudio permanece original."}</p><button className="button small secondary" disabled={busy} onClick={()=>void nativeAction(c.episode_id!,"resume")}>Retomar acompanhamento</button>{!nativeProgress.cancel_requested&&<button className="button small secondary" disabled={busy} onClick={()=>void nativeAction(c.episode_id!,"cancel")}>Encerrar tentativa</button>}</>}
                {c.episode_id && <Link className="button small secondary" href={`/studio/episodes/${c.episode_id}`}>{c.status==="review" ? "Revisar vídeo" : "Ver geração"}</Link>}</div>;
            })}</div>
            <div className="studio-actions"><button className="button primary" disabled={busy || stylePending || preparationPending || waiting || finished || cancelled || !data || data.active>0 || data.remaining===0} onClick={()=>void next(s)}>{finished ? "História concluída" : cancelled ? "Capítulo cancelado" : waiting ? "Aguarde e revise o capítulo" : stylePending ? "Geração deste padrão em preparação" : preparationPending ? "Ativação da criação animada pendente" : retry ? `Gerar capítulo ${last!.number} novamente${native ? ` · ${nativeCost} créditos Auray` : ""}` : !last || pending ? `Gerar capítulo ${last?.number ?? 1}${native ? ` · ${nativeCost} créditos Auray` : ""}` : `Continuar história · capítulo ${last.number+1}${native ? ` · ${nativeCost} créditos Auray` : ""}`}</button><p className="muted">{waiting ? "A continuação usa o resumo da versão aprovada. Abra a geração para revisar ou consultar uma falha." : stylePending ? "Configure as imagens e vozes deste estilo, quando disponível. O sistema aguarda um padrão salvo e uma fonte validada; escolher o estilo não reserva créditos de vídeo." : native && pattern ? `${shots} tomadas com vozes nativas: reserva de ${nativeCost} créditos gratuitos e duração aproximada de ${nativeCost} segundos. Confira falas, aparência e sincronia antes de aprovar. Não há substituição automática por outro motor.` : production || pattern ? "As falas são preparadas primeiro. A animação aguarda orçamento para o capítulo completo. A publicação depende da sua aprovação." : "Só este capítulo será gerado. A publicação sempre depende da sua aprovação."}</p>
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
