import { it } from "vitest";
import DxfParser from "dxf-parser";
import { buildModernHouse } from "../core/templates/modern-house";
import { buildPlanDxf } from "./plan-dxf";
import { writeFileSync } from "node:fs";
it("probe", () => {
  const p = buildModernHouse(new Date(0));
  const t = Date.now();
  const r = buildPlanDxf(p, "terreo", { now: new Date(0), paper: "A1", scale: 100 });
  console.log("ms", Date.now() - t, r.stats, r.warnings);
  writeFileSync("/tmp/claude-0/-home-user-project-atlas/8550d664-b912-52dd-99d0-465b20d44450/scratchpad/plan.dxf", r.dxf);
  const d = new DxfParser().parseSync(r.dxf)!;
  console.log(Object.keys(d), Object.keys(d.header), d.entities.length, [...new Set(d.entities.map((e) => e.type))]);
  console.log(JSON.stringify(d.entities.find((e) => e.type === "TEXT")), JSON.stringify(d.entities.find((e) => e.type === "ARC")), JSON.stringify(d.entities.find((e) => e.type === "SOLID")), JSON.stringify(d.header["$EXTMIN"]), Object.keys(d.tables));
});
