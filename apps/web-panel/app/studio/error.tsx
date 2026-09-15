"use client";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="legal">
      <h1>Não foi possível carregar o painel</h1>
      <p>Os dados não foram alterados por esta falha de exibição.</p>
      <button onClick={reset}>Tentar novamente</button>
    </main>
  );
}
