// Geometria de vídeo — funções PURAS (testáveis em Node).

/** "720p" é o MENOR lado do quadro: 1280×720 e 720×1280 (celular em pé) são
 *  ambos 720p. Rotular pela altura chamava um retrato de 720p de "1280p". */
export function frameLines(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0;
  return Math.min(width, height);
}

/** Quadro em pé (celular na vertical): mostrar inteiro com barras laterais, não cortar. */
export function isPortrait(width: number, height: number): boolean {
  return width > 0 && height > 0 && height > width;
}
