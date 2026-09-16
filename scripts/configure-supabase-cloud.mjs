const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Configure ${name}.`);
  return value;
}

try {
  for (const name of required) requiredEnv(name);
  const projectUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${projectUrl}/rest/v1/rpc/configure_content_ai_scheduler`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_project_url: projectUrl,
      p_service_role_key: serviceRoleKey,
    }),
  });
  const result = await response.json().catch(() => null);
  const jobNames = Array.isArray(result?.jobs) ? result.jobs.map((j) => j.job_name) : [];
  if (!response.ok || result?.configured !== true || !jobNames.includes("orchestrator-tick")) {
    throw new Error(`Supabase recusou a configuração do scheduler (HTTP ${response.status}).`);
  }
  console.log(`Vault, bucket assets e ${jobNames.join(", ")} configurados.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha na configuração cloud.");
  process.exitCode = 1;
}

