"use client";

// Preferência "espelhar minha imagem". PADRÃO: DESLIGADO — o outro lado sempre
// recebe o vídeo real (nunca espelhado); o espelho era só um efeito visual na
// própria prévia, e quem grava a tela acabava com a própria camisa ao contrário
// (relato do dono, 14/09/2026). Quem preferir se ver como num espelho liga no
// painel ⚙️; fica lembrado só neste navegador (conveniência, nunca dado).
import { useCallback, useEffect, useState } from "react";

const KEY = "meet.mirrorSelf";

export function useMirrorPreference(): [boolean, (on: boolean) => void] {
  const [mirror, setMirrorState] = useState(false);
  useEffect(() => {
    try {
      setMirrorState(window.localStorage.getItem(KEY) === "1");
    } catch {
      // armazenamento bloqueado — segue o padrão (sem espelho)
    }
  }, []);
  const setMirror = useCallback((on: boolean) => {
    setMirrorState(on);
    try {
      window.localStorage.setItem(KEY, on ? "1" : "0");
    } catch {
      // sem armazenamento: vale só nesta página
    }
  }, []);
  return [mirror, setMirror];
}

/** Caixa de seleção reutilizada na pré-chamada e no painel ⚙️. */
export function MirrorToggle({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[color:var(--color-ink-dim)]">
      <input
        type="checkbox"
        data-mirror-toggle
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[color:var(--color-brand)]"
      />
      Espelhar minha imagem (como num espelho). O outro lado sempre vê você do jeito certo.
    </label>
  );
}
