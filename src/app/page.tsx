import Link from "next/link";
import { JoinByCode } from "@/components/JoinByCode";
import { Footer } from "@/components/Footer";

// Home: um cartão único, no alto da página, com borda branca grossa e cantos bem
// arredondados, do título ao rodapé (rodapé DENTRO da borda) — pedido do dono
// em 13/09/2026, replicando o print editado por ele.
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 pb-10 pt-3">
      <div
        data-home-card
        className="flex min-h-[78vh] w-full max-w-3xl flex-col rounded-[3rem] border-[3px] border-white"
      >
        <div className="flex w-full flex-1 flex-col items-center gap-10 px-6 pb-12 pt-10 text-center">
          <div className="space-y-4">
            <h1 className="text-5xl font-bold tracking-tight">🎥 Meet App!</h1>
            <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--color-brand)]">
              Conversa Privada a Dois
            </p>
            <p className="mx-auto max-w-xl text-lg text-[color:var(--color-ink-dim)]">
              Chamadas de vídeo e voz entre duas pessoas, com privacidade de verdade: a
              conversa vai direto de um aparelho ao outro, sem passar por servidores no
              caminho. Nada é gravado, nada fica guardado.
            </p>
          </div>

          <div className="w-full max-w-md space-y-6">
            <JoinByCode />
            <p className="text-sm text-[color:var(--color-ink-dim)]">
              Recebeu um link? É só abrir — ele traz você direto para a sala.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link
              href="/painel"
              className="rounded-lg border border-[color:var(--color-line)] px-4 py-2 text-[color:var(--color-ink-dim)] transition hover:border-[color:var(--color-brand)] hover:text-[color:var(--color-ink)]"
            >
              Painel do administrador
            </Link>
            <Link
              href="/privacidade"
              className="rounded-lg border border-[color:var(--color-line)] px-4 py-2 text-[color:var(--color-ink-dim)] transition hover:border-[color:var(--color-brand)] hover:text-[color:var(--color-ink)]"
            >
              Como protegemos sua conversa
            </Link>
          </div>
        </div>
        <Footer />
      </div>
    </main>
  );
}
