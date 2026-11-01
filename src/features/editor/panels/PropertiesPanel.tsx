"use client";

import { AlertTriangle, AppWindow, Box, BrickWall, DoorOpen, Home, Layers, Plus, Trash2, Copy, RotateCw, Triangle } from "lucide-react";
import type { BuildingObject, Door, Element, Floor, Opening, Project, Roof, RoofType, Room, RoomType, Wall, WallCore, Window } from "@/core/model/schema";
import { ELEMENT_TYPE_LABEL, ROOM_TYPES, WALL_CORES, isOpening, isWall } from "@/core/model/schema";
import { ROOM_TYPE_INFO } from "@/core/model/factory";
import { roomShape } from "@/core/geometry/rooms";
import { roofGeometry } from "@/core/geometry/roof";
import { levelWalls } from "@/core/model/operations";
import { ROOF_TYPE_LABEL } from "./ToolPanel";
import { CATEGORIES } from "@/core/model/categories";
import { LIBRARY } from "@/core/library/catalog";
import { openingCenter, validateOpening, wallFrame, wallQuantities } from "@/core/geometry/wall";
import { floorArea, floorVolume } from "@/core/geometry/shapes";
import { projectStats } from "@/core/model/operations";
import { formatArea, formatLength, formatVolume, LENGTH_UNITS, type LengthUnit } from "@/core/units/units";
import { IconButton } from "@/ui/Button";
import { useEditor } from "../store";
import { AngleField, Grid2, LengthField, MaterialField, ReadOnly, Section, SelectField, Stat, TextField } from "./fields";

const ICON: Record<Element["type"], React.ComponentType<{ size?: number; className?: string }>> = {
  wall: BrickWall,
  door: DoorOpen,
  window: AppWindow,
  floor: Layers,
  object: Box,
  room: Home,
  roof: Triangle,
};

export const WALL_CORE_LABEL: Record<WallCore, string> = {
  "ceramic-brick": "Bloco cerâmico",
  "concrete-block": "Bloco de concreto",
  concrete: "Concreto",
  drywall: "Drywall",
};

export function PropertiesPanel() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  if (!project) return null;
  const el = project.elements.find((e) => e.id === selectedId);

  return (
    <div className="flex h-full flex-col" data-testid="properties-panel">
      <div className="flex h-10 shrink-0 items-center border-b border-ink-700 px-3.5">
        <span className="text-[12.5px] font-semibold">{el ? "Propriedades" : "Projeto"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {el ? <ElementProperties key={el.id} el={el} project={project} /> : <ProjectProperties project={project} />}
      </div>
    </div>
  );
}

function ElementProperties({ el, project }: { el: Element; project: Project }) {
  const { updateElement, deleteSelected, duplicateSelected, rotateSelected } = useEditor.getState();
  const unit = project.settings.displayUnit;
  const Icon = ICON[el.type];
  const kindLabel = el.type === "room" ? `Ambiente · ${ROOM_TYPE_INFO[el.roomType].label}` : el.type === "object" ? (LIBRARY.find((i) => i.spec.elementType === "object" && i.spec.kind === el.kind)?.name ?? el.kind) : ELEMENT_TYPE_LABEL[el.type];

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-ink-700 px-3.5 py-3">
        <span className="flex size-8 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium" data-testid="selected-name">{el.name}</div>
          <div className="text-[11.5px] text-fg-subtle">{kindLabel}</div>
        </div>
        <IconButton label="Girar 90°" shortcut="R" onClick={() => rotateSelected(90)} disabled={isOpening(el) || el.type === "room"}>
          <RotateCw size={15} />
        </IconButton>
        <IconButton label="Duplicar" shortcut="Ctrl+D" onClick={duplicateSelected} disabled={el.type === "room"}>
          <Copy size={15} />
        </IconButton>
        <IconButton label="Excluir" shortcut="Del" onClick={deleteSelected} className="hover:text-danger" data-testid="delete-element">
          <Trash2 size={15} />
        </IconButton>
      </div>

      <Section title="Identificação">
        <TextField label="Nome" value={el.name} onCommit={(name) => updateElement(el.id, { name })} testId="prop-name" />
        <ReadOnly label="Tipo" value={kindLabel} />
      </Section>

      {el.type === "wall" && <WallProps wall={el} project={project} unit={unit} />}
      {(el.type === "door" || el.type === "window") && <OpeningProps opening={el} project={project} unit={unit} />}
      {el.type === "floor" && <FloorProps floor={el} unit={unit} />}
      {el.type === "object" && <ObjectProps obj={el} unit={unit} />}
      {el.type === "room" && <RoomProps room={el} project={project} unit={unit} />}
      {el.type === "roof" && <RoofProps roof={el} unit={unit} />}

      <Section title="Aparência">
        <MaterialField
          value={el.materialId}
          onChange={(materialId) => updateElement(el.id, { materialId })}
          label={isOpening(el) ? "Material (caixilho / folha)" : el.type === "room" ? "Acabamento do piso" : el.type === "wall" ? "Acabamento (pintura / revestimento)" : "Material"}
        />
        {el.type === "wall" && (
          <SelectField label="Núcleo construtivo (alvenaria)" value={el.core} options={WALL_CORES.map((c) => ({ value: c, label: WALL_CORE_LABEL[c] }))} onChange={(core) => updateElement(el.id, { core })} />
        )}
      </Section>
    </>
  );
}

function WallProps({ wall, project, unit }: { wall: Wall; project: Project; unit: LengthUnit }) {
  const s = useEditor.getState();
  const f = wallFrame(wall);
  const openings = project.elements.filter(isOpening);
  const hosted = openings.filter((o) => o.hostId === wall.id);
  const q = wallQuantities(wall, openings);
  return (
    <>
      <Section title="Posição (início do eixo)">
        <Grid2>
          <LengthField label="X" value={wall.start.x} unit={unit} onCommit={(x) => s.moveBy(wall.id, { x: x - wall.start.x, y: 0 })} testId="prop-x" />
          <LengthField label="Y" value={wall.start.y} unit={unit} onCommit={(y) => s.moveBy(wall.id, { x: 0, y: y - wall.start.y })} testId="prop-y" />
          <LengthField label="Z (cota da base)" value={wall.baseElevation} unit={unit} onCommit={(baseElevation) => s.updateElement(wall.id, { baseElevation })} testId="prop-z" />
          <AngleField label="Ângulo" value={Math.round(f.angle * 100) / 100} onCommit={(a) => s.setWallAngle(wall.id, a)} />
        </Grid2>
      </Section>
      <Section title="Dimensões">
        <Grid2>
          <LengthField label="Comprimento" value={f.length} unit={unit} min={0.05} onCommit={(len) => s.setWallLength(wall.id, len)} testId="prop-length" />
          <LengthField label="Altura" value={wall.height} unit={unit} min={0.01} onCommit={(height) => s.updateElement(wall.id, { height })} testId="prop-height" />
          <LengthField label="Espessura" value={wall.thickness} unit={unit} min={0.01} onCommit={(thickness) => s.updateElement(wall.id, { thickness })} testId="prop-thickness" />
          <ReadOnly label="Fim (X; Y)" value={`${formatLength(wall.end.x, unit, { withUnit: false })}; ${formatLength(wall.end.y, unit, { withUnit: false })}`} />
        </Grid2>
      </Section>
      <Section title="Quantitativos">
        <Stat label="Área bruta (1 face)" value={formatArea(q.grossArea)} />
        <Stat label="Aberturas" value={formatArea(q.openingsArea)} />
        <Stat label="Área líquida (1 face)" value={formatArea(q.netArea)} />
        <Stat label="Volume" value={formatVolume(q.volume)} />
      </Section>
      <Section title={`Aberturas nesta parede (${hosted.length})`}>
        {hosted.length === 0 ? (
          <p className="text-[11.5px] leading-relaxed text-fg-subtle">Com a parede selecionada, clique em uma porta ou janela na biblioteca para inseri-la no centro.</p>
        ) : (
          hosted.map((o) => (
            <button key={o.id} onClick={() => s.select(o.id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-fg-muted hover:bg-ink-750 hover:text-fg">
              {o.type === "door" ? <DoorOpen size={13} /> : <AppWindow size={13} />}
              <span className="flex-1">{o.name}</span>
              <span className="font-mono text-[11px]">{formatLength(o.width, unit)}</span>
            </button>
          ))
        )}
      </Section>
    </>
  );
}

function OpeningProps({ opening, project, unit }: { opening: Opening; project: Project; unit: LengthUnit }) {
  const s = useEditor.getState();
  const walls = project.elements.filter(isWall);
  const host = walls.find((w) => w.id === opening.hostId);
  if (!host) return null;
  const issues = validateOpening(host, opening, project.elements.filter(isOpening));
  const c = openingCenter(host, opening);
  return (
    <>
      {issues.length > 0 && (
        <div className="mx-3.5 mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning" role="alert">
          {issues.map((i) => (
            <div key={i.code + i.message} className="flex gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {i.message}
            </div>
          ))}
        </div>
      )}
      <Section title="Associação">
        <SelectField
          label="Parede hospedeira"
          value={opening.hostId}
          options={walls.map((w) => ({ value: w.id, label: w.name }))}
          onChange={(hostId) => s.updateElement(opening.id, { hostId })}
        />
        <LengthField label="Posição no eixo da parede (centro)" value={opening.offset} unit={unit} min={0} onCommit={(offset) => s.updateElement(opening.id, { offset })} testId="prop-offset" />
      </Section>
      <Section title="Dimensões">
        <Grid2>
          <LengthField label="Largura" value={opening.width} unit={unit} min={0.1} onCommit={(width) => s.updateElement(opening.id, { width })} testId="prop-width" />
          <LengthField label="Altura" value={opening.height} unit={unit} min={0.1} onCommit={(height) => s.updateElement(opening.id, { height })} testId="prop-height" />
          {opening.type === "window" && (
            <LengthField label="Peitoril" value={(opening as Window).sillHeight} unit={unit} min={0} onCommit={(sillHeight) => s.updateElement(opening.id, { sillHeight })} testId="prop-sill" />
          )}
          <ReadOnly label="Espessura (parede)" value={formatLength(host.thickness, unit)} />
        </Grid2>
      </Section>
      {opening.type === "door" && (
        <Section title="Abertura da folha">
          <Grid2>
            <SelectField label="Dobradiça" value={(opening as Door).hinge} options={[{ value: "left", label: "Esquerda" }, { value: "right", label: "Direita" }]} onChange={(hinge) => s.updateElement(opening.id, { hinge })} />
            <SelectField label="Abre para" value={(opening as Door).opensTo} options={[{ value: "left", label: "Face A (esquerda)" }, { value: "right", label: "Face B (direita)" }]} onChange={(opensTo) => s.updateElement(opening.id, { opensTo })} />
          </Grid2>
        </Section>
      )}
      <Section title="Posição no espaço (calculada)">
        <Grid2>
          <ReadOnly label="X" value={formatLength(c.x, unit)} />
          <ReadOnly label="Y" value={formatLength(c.y, unit)} />
          <ReadOnly label="Z (centro)" value={formatLength(c.z, unit)} />
          <ReadOnly label="Área do vão" value={formatArea(opening.width * opening.height)} />
        </Grid2>
      </Section>
    </>
  );
}

function FloorProps({ floor, unit }: { floor: Floor; unit: LengthUnit }) {
  const s = useEditor.getState();
  const pos = (patch: Partial<Floor["position"]>) => s.updateElement(floor.id, { position: { ...floor.position, ...patch } });
  return (
    <>
      <Section title="Posição (centro)">
        <Grid2>
          <LengthField label="X" value={floor.position.x} unit={unit} onCommit={(x) => pos({ x })} testId="prop-x" />
          <LengthField label="Y" value={floor.position.y} unit={unit} onCommit={(y) => pos({ y })} testId="prop-y" />
          <LengthField label="Z (cota superior)" value={floor.position.z} unit={unit} onCommit={(z) => pos({ z })} testId="prop-z" />
          <AngleField label="Rotação" value={floor.rotation} onCommit={(rotation) => s.updateElement(floor.id, { rotation })} />
        </Grid2>
      </Section>
      <Section title="Dimensões">
        <Grid2>
          <LengthField label="Comprimento (X)" value={floor.width} unit={unit} min={0.05} onCommit={(width) => s.updateElement(floor.id, { width })} testId="prop-length" />
          <LengthField label="Largura (Y)" value={floor.depth} unit={unit} min={0.05} onCommit={(depth) => s.updateElement(floor.id, { depth })} testId="prop-width" />
          <LengthField label="Espessura" value={floor.thickness} unit={unit} min={0.005} onCommit={(thickness) => s.updateElement(floor.id, { thickness })} testId="prop-thickness" />
        </Grid2>
      </Section>
      <Section title="Quantitativos">
        <Stat label="Área" value={formatArea(floorArea(floor))} />
        <Stat label="Volume" value={formatVolume(floorVolume(floor))} />
      </Section>
    </>
  );
}

function ObjectProps({ obj, unit }: { obj: BuildingObject; unit: LengthUnit }) {
  const s = useEditor.getState();
  const pos = (patch: Partial<BuildingObject["position"]>) => s.updateElement(obj.id, { position: { ...obj.position, ...patch } });
  return (
    <>
      <Section title="Posição (centro da base)">
        <Grid2>
          <LengthField label="X" value={obj.position.x} unit={unit} onCommit={(x) => pos({ x })} testId="prop-x" />
          <LengthField label="Y" value={obj.position.y} unit={unit} onCommit={(y) => pos({ y })} testId="prop-y" />
          <LengthField label="Z (base)" value={obj.position.z} unit={unit} onCommit={(z) => pos({ z })} testId="prop-z" />
          <AngleField label="Rotação" value={obj.rotation} onCommit={(rotation) => s.updateElement(obj.id, { rotation })} />
        </Grid2>
      </Section>
      <Section title="Dimensões">
        <Grid2>
          <LengthField label="Comprimento" value={obj.length} unit={unit} min={0.01} onCommit={(length) => s.updateElement(obj.id, { length })} testId="prop-length" />
          <LengthField label="Largura" value={obj.width} unit={unit} min={0.01} onCommit={(width) => s.updateElement(obj.id, { width })} testId="prop-width" />
          <LengthField label="Altura" value={obj.height} unit={unit} min={0.01} onCommit={(height) => s.updateElement(obj.id, { height })} testId="prop-height" />
        </Grid2>
        {obj.kind === "stair-straight" && (
          <p className="text-[11px] leading-relaxed text-fg-subtle">Geometria indicativa. Dimensionamento de escadas deve seguir as normas aplicáveis e ser validado por profissional habilitado.</p>
        )}
      </Section>
    </>
  );
}

function RoomProps({ room, project, unit }: { room: Room; project: Project; unit: LengthUnit }) {
  const s = useEditor.getState();
  const shape = roomShape(levelWalls(project, room.levelId), room.seed);
  const doors = shape ? project.elements.filter((e) => e.type === "door" && shape.wallIds.includes(e.hostId)).length : 0;
  const windows = shape ? project.elements.filter((e) => e.type === "window" && shape.wallIds.includes(e.hostId)).length : 0;
  return (
    <>
      {!shape && (
        <div className="mx-3.5 mt-3 flex gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-warning" role="alert">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Este ambiente não está fechado por paredes. Feche o contorno para calcular área e piso.
        </div>
      )}
      <Section title="Ambiente">
        <SelectField label="Tipo" value={room.roomType} options={ROOM_TYPES.map((t) => ({ value: t, label: ROOM_TYPE_INFO[t].label }))} onChange={(roomType: RoomType) => s.updateElement(room.id, { roomType })} />
        {shape?.rect ? (
          <Grid2>
            <LengthField label="Largura (X)" value={shape.rect.maxX - shape.rect.minX} unit={unit} min={0.6} onCommit={(v) => s.resizeRoom(room.id, "x", v)} testId="room-width" />
            <LengthField label="Profundidade (Y)" value={shape.rect.maxY - shape.rect.minY} unit={unit} min={0.6} onCommit={(v) => s.resizeRoom(room.id, "y", v)} testId="room-depth" />
          </Grid2>
        ) : (
          shape && <p className="text-[11.5px] text-fg-subtle">Formato não retangular: altere movendo as paredes.</p>
        )}
        <p className="text-[11px] leading-relaxed text-fg-subtle">Medidas pelos eixos das paredes. Alterar move a parede do lado leste/norte; cômodos vizinhos se ajustam.</p>
      </Section>
      <Section title="Quantitativos do ambiente">
        <Stat label="Área útil" value={shape ? formatArea(shape.area) : "—"} />
        <Stat label="Perímetro interno" value={shape ? formatLength(shape.perimeter, unit) : "—"} />
        <Stat label="Portas / janelas" value={`${doors} / ${windows}`} />
        {shape && doors === 0 && <p className="text-[11.5px] text-warning">Sem porta: insira uma porta em uma das paredes do ambiente.</p>}
      </Section>
      <Section title="Forro / teto">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg-muted">
          <input type="checkbox" className="accent-accent" checked={room.ceiling} onChange={(e) => s.updateElement(room.id, { ceiling: e.target.checked })} /> Possui forro
        </label>
        {room.ceiling && (
          <>
            <LengthField label="Altura do forro" value={room.ceilingHeight} unit={unit} min={2} onCommit={(ceilingHeight) => s.updateElement(room.id, { ceilingHeight })} />
            <MaterialField label="Material do forro" value={room.ceilingMaterialId} onChange={(ceilingMaterialId) => s.updateElement(room.id, { ceilingMaterialId })} />
          </>
        )}
      </Section>
    </>
  );
}

function RoofProps({ roof, unit }: { roof: Roof; unit: LengthUnit }) {
  const s = useEditor.getState();
  const g = roofGeometry(roof);
  return (
    <>
      <Section title="Cobertura">
        <SelectField label="Tipo" value={roof.roofType} options={(Object.keys(ROOF_TYPE_LABEL) as RoofType[]).map((r) => ({ value: r, label: ROOF_TYPE_LABEL[r] }))} onChange={(roofType) => s.updateElement(roof.id, { roofType })} />
        <Grid2>
          <AngleField label="Inclinação" value={roof.pitch} onCommit={(pitch) => s.updateElement(roof.id, { pitch })} />
          <LengthField label="Beiral" value={roof.overhang} unit={unit} min={0} onCommit={(overhang) => s.updateElement(roof.id, { overhang })} />
          <LengthField label="Largura (X)" value={roof.width} unit={unit} min={0.5} onCommit={(width) => s.updateElement(roof.id, { width })} />
          <LengthField label="Profundidade (Y)" value={roof.depth} unit={unit} min={0.5} onCommit={(depth) => s.updateElement(roof.id, { depth })} />
          <LengthField label="Altura do beiral" value={roof.baseHeight} unit={unit} onCommit={(baseHeight) => s.updateElement(roof.id, { baseHeight })} />
          <AngleField label="Rotação" value={roof.rotation} onCommit={(rotation) => s.updateElement(roof.id, { rotation })} />
        </Grid2>
      </Section>
      <Section title="Quantitativos">
        <Stat label="Área inclinada" value={formatArea(g.area)} />
        <Stat label="Projeção (com beirais)" value={formatArea(g.footprint)} />
        <Stat label="Cumeeira" value={formatLength(g.ridge, unit)} />
        <Stat label="Altura da cumeeira" value={formatLength(g.rise, unit)} />
        <p className="pt-1 text-[11px] text-fg-subtle">Geometria indicativa. A estrutura do telhado deve ser projetada por profissional habilitado.</p>
      </Section>
    </>
  );
}

function LevelsSection({ project }: { project: Project }) {
  const s = useEditor.getState();
  const active = useEditor((st) => st.activeLevelId);
  const unit = project.settings.displayUnit;
  return (
    <Section title="Pavimentos" action={<button onClick={s.addLevelAbove} className="flex items-center gap-1 text-[11.5px] text-accent hover:text-accent-hover" data-testid="add-level"><Plus size={12} /> Adicionar</button>}>
      {[...project.levels].reverse().map((l) => (
        <div key={l.id} className={`rounded-md border p-2 ${l.id === active ? "border-accent-line bg-accent-soft" : "border-ink-700"}`}>
          <div className="flex items-center gap-2">
            <button className="flex-1 text-left text-[12.5px] font-medium" onClick={() => s.setActiveLevel(l.id)}>{l.name}</button>
            {project.levels.length > 1 && (
              <button className="text-fg-subtle hover:text-danger" title="Excluir pavimento e seus elementos" onClick={() => { if (window.confirm(`Excluir "${l.name}" e todos os seus elementos?`)) s.deleteLevel(l.id); }}><Trash2 size={13} /></button>
            )}
          </div>
          {l.id === active && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <TextField label="Nome" value={l.name} onCommit={(name) => s.updateLevel(l.id, { name })} />
              <LengthField label="Cota do piso" value={l.elevation} unit={unit} onCommit={(elevation) => s.updateLevel(l.id, { elevation })} />
              <LengthField label="Piso a piso" value={l.height} unit={unit} min={2} onCommit={(height) => s.updateLevel(l.id, { height })} />
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

function ProjectProperties({ project }: { project: Project }) {
  const s = useEditor.getState();
  const unit = project.settings.displayUnit;
  const st = projectStats(project);
  return (
    <>
      <Section title="Projeto">
        <TextField label="Nome" value={project.name} onCommit={(name) => s.updateProject({ name })} />
        <SelectField label="Categoria" value={project.category} options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} onChange={(category) => s.updateProject({ category })} />
      </Section>
      <LevelsSection project={project} />
      <Section title="Terreno / área de trabalho">
        <Grid2>
          <LengthField label="Largura (X)" value={project.site.width} unit={unit} min={0.5} onCommit={(width) => s.updateProject({ site: { ...project.site, width } })} />
          <LengthField label="Profundidade (Y)" value={project.site.depth} unit={unit} min={0.5} onCommit={(depth) => s.updateProject({ site: { ...project.site, depth } })} />
        </Grid2>
      </Section>
      <Section title="Configurações">
        <Grid2>
          <SelectField label="Unidade de exibição" value={unit} options={LENGTH_UNITS.map((u) => ({ value: u, label: u === "m" ? "Metros (m)" : u === "cm" ? "Centímetros (cm)" : "Milímetros (mm)" }))} onChange={(displayUnit) => s.updateSettings({ displayUnit })} />
          <LengthField label="Passo da grade" value={project.settings.gridSize} unit={unit} min={0.001} onCommit={(gridSize) => s.updateSettings({ gridSize })} />
          <LengthField label="Altura padrão de parede" value={project.settings.defaultWallHeight} unit={unit} min={0.1} onCommit={(defaultWallHeight) => s.updateSettings({ defaultWallHeight })} />
          <LengthField label="Espessura padrão" value={project.settings.defaultWallThickness} unit={unit} min={0.01} onCommit={(defaultWallThickness) => s.updateSettings({ defaultWallThickness })} />
        </Grid2>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-[12px] text-fg-muted">
          <input type="checkbox" className="accent-accent" checked={project.settings.snapToGrid} onChange={(e) => s.updateSettings({ snapToGrid: e.target.checked })} />
          Atrair à grade (snap)
        </label>
      </Section>
      <Section title="Resumo do modelo">
        <Stat label="Pavimentos" value={String(st.levels)} />
        <Stat label="Ambientes" value={`${st.rooms} · ${formatArea(st.totalRoomArea)}`} />
        <Stat label="Telhados" value={`${st.roofs} · ${formatArea(st.totalRoofArea)}`} />
        <Stat label="Paredes" value={String(st.walls)} />
        <Stat label="Portas / janelas" value={`${st.doors} / ${st.windows}`} />
        <Stat label="Pisos" value={String(st.floors)} />
        <Stat label="Objetos" value={String(st.objects)} />
        <div className="my-1 h-px bg-ink-700" />
        <Stat label="Comprimento de paredes" value={formatLength(st.totalWallLength, unit)} />
        <Stat label="Área líquida de paredes" value={formatArea(st.totalWallNetArea)} />
        <Stat label="Volume de paredes" value={formatVolume(st.totalWallVolume)} />
        <Stat label="Área de pisos" value={formatArea(st.totalFloorArea)} />
        <p className="pt-1 text-[11px] leading-relaxed text-fg-subtle">Quantitativos geométricos para estudo. Não substituem levantamento técnico.</p>
      </Section>
      <p className="px-3.5 py-3 text-[11.5px] leading-relaxed text-fg-subtle">Selecione um elemento no modelo para editar suas propriedades.</p>
    </>
  );
}
