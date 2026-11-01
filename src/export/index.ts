/**
 * Exportação CAD (DXF R12/AC1009, ASCII) do PROJECT ATLAS.
 * DWG é formato proprietário e NÃO é gerado. Ver comentários em `dxf-writer.ts`.
 */
export { buildPlanDxf, PLAN_CUT_HEIGHT } from "./plan-dxf";
export { buildElevationDxf, type ElevationSide } from "./elevation-dxf";
export { buildSectionDxf } from "./section-dxf";
export { buildSheetSet, buildingCentre, type SheetOutput, type SheetSetOptions } from "./sheet-set";
export { buildOpeningSchedule, buildAreaRows, type OpeningSchedule, type OpeningType } from "./schedules";
export { verifyDxf, structuralCheck, type VerifyReport } from "./verify";
export { DxfWriter, toAscii, type TextEncoding } from "./dxf-writer";
export {
  DISCLAIMER,
  LAYER_DEFS,
  PAPER_MM,
  PAPER_SIZES,
  PLOT_SCALES,
  type DxfResult,
  type ExportOptions,
  type PaperSize,
  type PlotScale,
} from "./sheet";
