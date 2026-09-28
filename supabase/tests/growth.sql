\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Growth assertion: %',label; end if; end $$;
do $$
declare candidate uuid; consumed uuid; result jsonb; payload jsonb; episode uuid; rev integer;
begin
  update public.idea_queue set status='rejected' where status='pending';
  insert into public.idea_queue(briefing,niche,source,priority)
    values('Gadget candidato ainda sem pesquisa humana.','gadgets_produtos_inovadores','trend_discovery',1) returning id into candidate;
  perform pg_temp.expect(not exists(select 1 from public.consume_next_idea_unchecked()),'unvalidated candidate cannot produce');
  payload:=jsonb_build_object('id',candidate,'revision',0,'briefing','Gadget pesquisado e validado para pauta editorial.','priority',1,'affiliate_links','{}'::jsonb);
  result:=public.web_panel_mutation(gen_random_uuid(),gen_random_uuid(),'edit',payload);
  perform pg_temp.expect(result->>'code'='updated','legacy edit remains possible');
  perform pg_temp.expect(not exists(select 1 from public.consume_next_idea_unchecked()),
    'editing a broad trend does not start a video');
  update public.idea_queue set recommendations=jsonb_build_array(jsonb_build_object(
    'product_name','Anker MagGo UFO 3-in-1','hook','Uma base dobrável para três aparelhos.',
    'problem','Cabos espalhados na mesa e na mochila.',
    'limitation','Compatibilidade depende do aparelho.',
    'why_now','Aparece na pesquisa de gadgets do ano.',
    'source_url','https://example.com/anker-maggio')) where id=candidate;
  select revision into rev from public.idea_queue where id=candidate;
  result:=public.web_panel_candidate_action(gen_random_uuid(),gen_random_uuid(),'choose_product',
    jsonb_build_object('id',candidate,'revision',rev,'index',0));
  perform pg_temp.expect(result->>'code'='product_chosen','explicit product selection succeeds');
  perform pg_temp.expect(not exists(select 1 from public.consume_next_idea_unchecked()),
    'product selection alone does not start a video');
  update public.system_config set value=value||'{"enabled":true,"max_episodes_per_day":10}'::jsonb where key='pipeline';
  select revision into rev from public.idea_queue where id=candidate;
  result:=public.web_panel_candidate_action(gen_random_uuid(),gen_random_uuid(),'generate_video',
    jsonb_build_object('id',candidate,'revision',rev));
  perform pg_temp.expect(result->>'code'='started','generate video starts selected product');
  episode:=(result->>'episode_id')::uuid;
  perform pg_temp.expect((select product_compliance is null from public.episodes where id=episode),
    'product recommendation does not imply affiliation');
  perform pg_temp.expect((select briefing->>'product_name'='Anker MagGo UFO 3-in-1' from public.episodes where id=episode),
    'episode is about one concrete product');
  perform pg_temp.expect(not exists(select 1 from public.consume_next_idea_unchecked()),'candidate consumed once');
  -- Legacy manual ideas remain eligible without a second validation step.
  insert into public.idea_queue(briefing,niche,priority) values('Pauta cadastrada pelo operador manualmente.','gadgets_produtos_inovadores',1);
  perform pg_temp.expect(exists(select 1 from public.consume_next_idea_unchecked()),'manual queue backward compatible');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.consume_next_idea_unchecked()','execute'),'candidate gate RPC not public');
rollback;
