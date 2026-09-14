\set ON_ERROR_STOP on
-- Same update delivered to twelve workers, then twelve distinct additions compete for capacity.
select public.telegram_queue_command(31000,'-123','456','idea','Pauta unica enviada simultaneamente por doze workers.');
select public.telegram_queue_command(1000000+pg_backend_pid(),'-123','456','idea','Nova pauta concorrente para conferir o limite de capacidade.');
