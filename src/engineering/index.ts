import type { Project } from "../core/model/schema";
import { designRoof, type RoofDesign, type RoofDesignParams } from "./roof";
import { designWaterSystem, type WaterDesign, type WaterParams } from "./water";
import { predimensionStructure, type StructureParams, type StructureResult } from "./structure";
import { CALC_STATUS, DISCLAIMER, type CalcStatus } from "./types";

export * from "./types";
export * from "./roof";
export * from "./water";
export * from "./structure";
export { ceilTo, structuralWalls, wallSkeleton } from "./common";

export interface EngineeringParams {
  /** Intensidade de chuva (mm/h): repassada à cobertura. SEM padrão. */
  rainIntensityMmH?: number;
  /** σadm do solo (kPa): repassada à estrutura. SEM padrão. */
  soilAllowableKPa?: number;
  roof?: RoofDesignParams;
  water?: WaterParams;
  structure?: StructureParams;
}

export interface EngineeringSummary {
  status: CalcStatus;
  roofs: RoofDesign[] | null;
  water: WaterDesign | null;
  structure: StructureResult | null;
  missingInputs: string[];
  warnings: string[];
}

/** Combina cobertura, água e estrutura; cada parte falha/omite-se de forma independente. */
export function engineeringSummary(project: Project, params: EngineeringParams = {}): EngineeringSummary {
  const warnings: string[] = [DISCLAIMER];
  const warned = new Set<string>(warnings);
  const missing = new Set<string>();
  const attempt = <T,>(label: string, fn: () => T): T | null => {
    try {
      return fn();
    } catch (e) {
      warnings.push(`${label}: não calculado (${e instanceof Error ? e.message : String(e)}).`);
      return null;
    }
  };

  const roofEls = project.elements.filter((e) => e.type === "roof");
  const roofs = attempt("Cobertura", () =>
    roofEls.map((r) => designRoof(r, { ...params.roof, rainIntensityMmH: params.roof?.rainIntensityMmH ?? params.rainIntensityMmH })),
  );
  const water = attempt("Água fria", () => designWaterSystem(project, params.water));
  const structure = attempt("Estrutura", () =>
    predimensionStructure(project, { ...params.structure, soilAllowableKPa: params.structure?.soilAllowableKPa ?? params.soilAllowableKPa }),
  );
  if (roofEls.length === 0) warnings.push("Nenhum telhado no projeto: cobertura e calhas não calculadas.");

  for (const part of [...(roofs ?? []), water, structure]) {
    if (!part) continue;
    part.missingInputs.forEach((m) => missing.add(m));
    for (const w of part.warnings) {
      if (warned.has(w)) continue;
      warned.add(w);
      warnings.push(w);
    }
  }
  return { status: CALC_STATUS, roofs, water, structure, missingInputs: [...missing], warnings };
}
