/** Avatar do participante: foto (se houver) ou inicial do nome. */
export function Avatar({
  name,
  photoUrl,
  size = 96,
}: {
  name: string;
  photoUrl: string | null;
  size?: number;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- objectURL local, nunca URL remota
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      aria-label={name}
      className="flex items-center justify-center rounded-full bg-[color:var(--color-brand-soft)] font-bold text-[color:var(--color-brand)]"
      style={{ width: size, height: size, fontSize: size / 2.5 }}
    >
      {initial}
    </div>
  );
}
