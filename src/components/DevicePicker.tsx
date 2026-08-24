"use client";

// Seletores de câmera e microfone — usados na pré-chamada e no painel ⚙️
// durante a reunião (mesmo componente, comportamentos idênticos).
import type { MediaDeviceOption } from "@/lib/client/media";

const selectClass =
  "w-full rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-panel-2)] px-3 py-2 text-sm text-[color:var(--color-ink)] outline-none transition focus:border-[color:var(--color-brand)] disabled:opacity-50";

export function DevicePicker({
  cams,
  mics,
  camId,
  micId,
  showCamera,
  disabled = false,
  onCam,
  onMic,
}: {
  cams: MediaDeviceOption[];
  mics: MediaDeviceOption[];
  camId: string;
  micId: string;
  showCamera: boolean;
  disabled?: boolean;
  onCam: (id: string) => void;
  onMic: (id: string) => void;
}) {
  if (mics.length === 0 && cams.length === 0) return null;
  return (
    <div className="space-y-3">
      {mics.length > 0 && (
        <label className="block space-y-1">
          <span className="text-sm text-[color:var(--color-ink-dim)]">🎙️ Microfone</span>
          <select
            value={micId}
            disabled={disabled}
            onChange={(e) => onMic(e.target.value)}
            className={selectClass}
          >
            {mics.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {showCamera && cams.length > 0 && (
        <label className="block space-y-1">
          <span className="text-sm text-[color:var(--color-ink-dim)]">📹 Câmera</span>
          <select
            value={camId}
            disabled={disabled}
            onChange={(e) => onCam(e.target.value)}
            className={selectClass}
          >
            {cams.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
