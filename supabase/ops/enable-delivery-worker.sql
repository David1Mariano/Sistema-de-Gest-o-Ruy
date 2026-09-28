-- OPCIONAL: executar somente depois de configurar e testar as Edge Functions.
-- Ativar pg_cron, pg_net e Vault no Dashboard antes. Não contém credenciais.
-- Criar no Vault: delivery_project_url e delivery_worker_secret (mesmo valor
-- do secret DELIVERY_WORKER_SECRET da função, no mínimo 32 caracteres aleatórios).
do $$
begin
  if exists(select 1 from cron.job where jobname='ruy-delivery-worker') then
    raise exception 'Job já existe; revisar antes de substituir';
  end if;
  if (select count(*) from vault.decrypted_secrets where name='delivery_project_url' and decrypted_secret like 'https://%.supabase.co') <> 1
    or (select count(*) from vault.decrypted_secrets where name='delivery_worker_secret' and length(decrypted_secret)>=32) <> 1 then
    raise exception 'Configurar os dois secrets no Vault antes';
  end if;
end $$;
select cron.schedule('ruy-delivery-worker', '30 seconds', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='delivery_project_url') || '/functions/v1/delivery-api',
    headers := jsonb_build_object('Content-Type','application/json','x-delivery-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='delivery_worker_secret')),
    body := '{"action":"sync","platform":"ifood"}'::jsonb,
    timeout_milliseconds := 90000
  );
$job$);
-- Desativar sem apagar pedidos: select cron.unschedule('ruy-delivery-worker');
