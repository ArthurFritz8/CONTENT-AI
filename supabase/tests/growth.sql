\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'Growth assertion: %',label; end if; end $$;
do $$
declare candidate uuid; consumed uuid; result jsonb; payload jsonb; episode uuid;
begin
  update public.idea_queue set status='rejected' where status='pending';
  insert into public.idea_queue(briefing,niche,source,priority)
    values('Gadget candidato ainda sem pesquisa humana.','gadgets_produtos_inovadores','trend_discovery',1) returning id into candidate;
  perform pg_temp.expect(not exists(select 1 from public.consume_next_idea_unchecked()),'unvalidated candidate cannot produce');
  payload:=jsonb_build_object('id',candidate,'revision',0,'briefing','Gadget pesquisado e validado para pauta editorial.','priority',1,'affiliate_links','{}'::jsonb);
  result:=public.web_panel_mutation(gen_random_uuid(),gen_random_uuid(),'edit',payload);
  perform pg_temp.expect(result->>'code'='updated','human validation succeeds');
  perform pg_temp.expect((select validated_at is not null and source='trend_discovery' and product_url is null and affiliate_links='{}'::jsonb from public.idea_queue where id=candidate),'validation preserves origin without inventing affiliate');
  select idea_id,episode_id into consumed,episode from public.consume_next_idea_unchecked();
  perform pg_temp.expect(consumed=candidate,'validated candidate can produce');
  perform pg_temp.expect((select product_compliance is null from public.episodes where id=episode),'editorial validation does not imply affiliation');
  perform pg_temp.expect(not exists(select 1 from public.consume_next_idea_unchecked()),'candidate consumed once');
  -- Legacy manual ideas remain eligible without a second validation step.
  insert into public.idea_queue(briefing,niche,priority) values('Pauta cadastrada pelo operador manualmente.','gadgets_produtos_inovadores',1);
  perform pg_temp.expect(exists(select 1 from public.consume_next_idea_unchecked()),'manual queue backward compatible');
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.consume_next_idea_unchecked()','execute'),'candidate gate RPC not public');
rollback;
