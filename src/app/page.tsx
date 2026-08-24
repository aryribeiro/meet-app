import Link from "next/link";
import { JoinByCode } from "@/components/JoinByCode";
import { Footer } from "@/components/Footer";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-widest text-[color:var(--color-brand)]">
            conversas só entre vocês dois
          </p>
          <h1 className="text-5xl font-bold tracking-tight">Meet App!</h1>
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
    </main>
  );
}
