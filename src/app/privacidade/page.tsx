// Nota de privacidade HONESTA (entregável do contrato): o que está protegido,
// o que não está, sem exagero — em linguagem que qualquer pessoa entende.
import Link from "next/link";
import { Footer } from "@/components/Footer";

export const metadata = {
  title: "Privacidade — Meet App!",
};

export default function PrivacyPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-6 py-12">
        <div className="space-y-2">
          <Link href="/" className="text-sm text-[color:var(--color-ink-dim)] hover:underline">
            ← Início
          </Link>
          <h1 className="text-3xl font-bold">Como protegemos sua conversa</h1>
          <p className="text-[color:var(--color-ink-dim)]">
            Sem letras miúdas: aqui está exatamente o que fica protegido e o que não fica.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--color-ok)]">
            ✓ O que está protegido
          </h2>
          <ul className="space-y-3 text-[color:var(--color-ink-dim)]">
            <li>
              <strong className="text-[color:var(--color-ink)]">Sua voz e sua imagem.</strong>{" "}
              A conversa vai criptografada direto do seu aparelho para o do outro
              participante. Ela não passa pelos nossos servidores — nem nós conseguimos
              assistir ou ouvir.
            </li>
            <li>
              <strong className="text-[color:var(--color-ink)]">Seu nome e sua foto.</strong>{" "}
              Também vão direto de um aparelho ao outro. Nunca são enviados para nós.
            </li>
            <li>
              <strong className="text-[color:var(--color-ink)]">Nada é gravado.</strong>{" "}
              Não existe gravação, não existe histórico. Quando a conversa termina, ela
              acabou de verdade — e o link para de funcionar.
            </li>
            <li>
              <strong className="text-[color:var(--color-ink)]">O código de segurança.</strong>{" "}
              No início da chamada, os dois lados veem um código de 6 dígitos. Leiam um
              para o outro em voz alta: se for igual, vocês têm certeza de que ninguém —
              nem mesmo quem opera este serviço — está no meio da conversa. Se algum dia
              aparecer diferente, desliguem e conversem por outro canal.
            </li>
            <li>
              <strong className="text-[color:var(--color-ink)]">Sem rastreadores.</strong>{" "}
              Não usamos ferramentas de análise de comportamento nem cookies de propaganda.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-[color:var(--color-warn)]">
            ⚠ O que não está protegido (e por quê)
          </h2>
          <ul className="space-y-3 text-[color:var(--color-ink-dim)]">
            <li>
              <strong className="text-[color:var(--color-ink)]">
                O outro participante pode ver seu endereço de internet.
              </strong>{" "}
              Como a conversa vai direto de um aparelho ao outro, cada lado enxerga o
              endereço de rede do outro — como numa ligação a cobrar, quem atende sabe de
              onde veio. Se o serviço estiver com o modo de privacidade extra disponível,
              você pode ativá-lo na entrada para esconder seu endereço (a chamada pode
              ficar um pouco mais lenta).
            </li>
            <li>
              <strong className="text-[color:var(--color-ink)]">
                Sabemos que uma conversa aconteceu.
              </strong>{" "}
              Para conectar vocês dois, nossos servidores veem o horário, a duração
              aproximada e os endereços de internet de quem participou — mas nunca o
              conteúdo. É como o carteiro: sabe que houve carta, não sabe o que está
              escrito.
            </li>
            <li>
              <strong className="text-[color:var(--color-ink)]">
                A segurança do seu aparelho é sua.
              </strong>{" "}
              Se o celular ou computador de um dos dois estiver comprometido, nenhuma
              criptografia resolve — quem vê sua tela, vê sua chamada.
            </li>
          </ul>
        </section>

        <section className="space-y-2 rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-panel)] p-6 text-sm text-[color:var(--color-ink-dim)]">
          <p>
            <strong className="text-[color:var(--color-ink)]">Resumo:</strong> o conteúdo da
            sua conversa é só de vocês dois — confirmado pelo código de segurança lido em
            voz alta. O que existe de metadado (quem, quando, por quanto tempo) é o mínimo
            necessário para a ligação acontecer, e some junto com a sala.
          </p>
        </section>
      </div>
      <Footer />
    </main>
  );
}
