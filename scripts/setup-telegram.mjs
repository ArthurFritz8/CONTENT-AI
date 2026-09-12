// Operator-run setup only. Never expose the bot-token-bearing URL in output/errors.
const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_USER_ID', 'TELEGRAM_WEBHOOK_SECRET', 'SUPABASE_URL'];
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Uso: node --env-file=.env.cloud scripts/setup-telegram.mjs [--check]\n--check valida somente as variáveis locais; sem flag registra o webhook.');
    process.exit(0);
  }
  if (args.some(arg => arg !== '--check')) throw new Error('Argumento desconhecido. Use --help.');
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Configure: ${missing.join(', ')}`);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET)) throw new Error('TELEGRAM_WEBHOOK_SECRET exige 32–256 caracteres A-Z, a-z, 0-9, _ ou -.');
  if (!/^-?\d+$/.test(process.env.TELEGRAM_CHAT_ID) || !/^[1-9]\d*$/.test(process.env.TELEGRAM_USER_ID)) throw new Error('IDs Telegram inválidos.');
  let url;
  try { url = new URL('/functions/v1/telegram-bot', process.env.SUPABASE_URL); }
  catch { throw new Error('SUPABASE_URL inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('SUPABASE_URL deve ser HTTPS sem credenciais.');
  if (process.argv.includes('--check')) {
    console.log('Configuração local válida; nenhuma chamada Telegram executada.');
  } else {
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: {'Content-Type':'application/json'},
        body: JSON.stringify({url: url.href, secret_token:process.env.TELEGRAM_WEBHOOK_SECRET,
          allowed_updates:['message','callback_query'], max_connections:1, drop_pending_updates:false}),
      });
    } catch { throw new Error('Resultado da configuração não confirmado. Confira o webhook antes de repetir.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true) throw new Error('Telegram não confirmou o webhook. Verifique as credenciais e o deploy.');
    console.log('Webhook configurado. Envie /start ao bot pelo usuário e chat permitidos.');
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : 'Falha na configuração Telegram.');
  process.exitCode = 1;
}
