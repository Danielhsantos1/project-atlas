import type { ProjectSummary } from "@/persistence/summary";

/**
 * Miniatura de planta desenhada a partir da geometria salva no índice
 * (não é uma captura de tela).
 */
export function PlanPreview({ preview, site }: { preview: ProjectSummary["preview"]; site: ProjectSummary["site"] }) {
  const b = preview.bounds ?? { minX: 0, minY: 0, maxX: site.width, maxY: site.depth };
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.12 + 0.5;
  const minX = b.minX - pad;
  const maxY = b.maxY + pad;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxY - b.minY + pad * 2;
  const pts = (flat: number[]) => {
    const out: string[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(`${flat[i]! - minX},${maxY - flat[i + 1]!}`);
    return out.join(" ");
  };

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="size-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      {preview.floors.map((f, i) => (
        <polygon key={`f${i}`} points={pts(f)} fill="rgb(47 128 255 / 0.08)" stroke="rgb(47 128 255 / 0.25)" strokeWidth={0.03} />
      ))}
      {preview.objects.map((o, i) => (
        <polygon key={`o${i}`} points={pts(o)} fill="none" stroke="#6c7584" strokeWidth={0.03} />
      ))}
      {preview.walls.map(([x1, y1, x2, y2, t], i) => (
        <line key={`w${i}`} x1={x1! - minX} y1={maxY - y1!} x2={x2! - minX} y2={maxY - y2!} stroke="#d5dae2" strokeWidth={Math.max(t!, 0.08)} strokeLinecap="square" />
      ))}
      {!preview.bounds && (
        <rect x={pad} y={pad} width={site.width} height={site.depth} fill="none" stroke="#3a424e" strokeWidth={0.06} strokeDasharray="0.3 0.2" />
      )}
    </svg>
  );
}
