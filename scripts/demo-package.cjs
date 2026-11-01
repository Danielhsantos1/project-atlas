/**
 * Gera o pacote demonstrativo da RESIDÊNCIA MODERNA DE DOIS PAVIMENTOS:
 * plantas, 3D, dollhouse, fachadas, cortes, lista de ambientes, quantitativos,
 * orçamento demonstrativo (preços de EXEMPLO) e proposta em PDF.
 * Uso: npm run demo   (app rodando; BASE_URL opcional)
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.join(__dirname, "..", "e2e-artifacts", "demo-residencia-moderna");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const shot = async (name) => { await p.waitForTimeout(1400); await p.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log("•", name); };

  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "networkidle" });
  await p.getByTestId("home-tpl").click(); await p.getByTestId("template-modern-house").click();
  await p.waitForURL(/\/editor\//); await p.waitForTimeout(3200);
  // Painéis laterais recolhidos para valorizar o modelo.
  await p.keyboard.press("["); await p.keyboard.press("]");

  await p.getByTestId("view-3d").click(); await shot("01-visualizacao-3d-completa");
  await p.getByTestId("view-dollhouse").click(); await shot("02-dollhouse-terreo");
  await p.getByTestId("level-selector").getByText("Pavimento superior").click(); await p.getByTestId("view-dollhouse").click(); await shot("03-dollhouse-superior");
  await p.getByTestId("level-selector").getByText("Térreo").click();
  await p.getByTestId("view-2d").click(); await shot("04-planta-terreo");
  await p.getByTestId("level-selector").getByText("Pavimento superior").click(); await shot("05-planta-superior");
  await p.getByTestId("level-selector").getByText("Térreo").click();
  await p.getByTestId("view-facade").click();
  for (const [label, name] of [["Frontal (sul)", "06-fachada-frontal"], ["Posterior (norte)", "07-fachada-posterior"], ["Lateral esquerda (oeste)", "08-fachada-oeste"], ["Lateral direita (leste)", "09-fachada-leste"]]) { await p.getByText(label).click(); await shot(name); }
  await p.getByTestId("view-section").click();
  await p.locator('select[aria-label="Corte vertical"]').selectOption("y"); await p.locator('input[aria-label="Posição do corte vertical"]').fill("14.5"); await p.locator('input[aria-label="Altura do corte horizontal"]').fill("4"); await shot("10-corte-vertical-longitudinal");
  await p.locator('select[aria-label="Corte vertical"]').selectOption("none"); await p.locator('input[aria-label="Altura do corte horizontal"]').fill("1.2"); await shot("11-corte-horizontal-terreo");
  await p.getByTestId("view-construction").click();
  for (const [stage, name] of [["3", "12-etapa-estrutura"], ["4", "13-etapa-alvenaria"], ["8", "14-etapa-final"]]) { await p.getByTestId("stage-slider").fill(stage); await shot(name); }
  await p.getByTestId("view-interior").click(); await p.locator('select[aria-label="Ambiente"]').selectOption({ label: "Cozinha" }); await shot("15-interior-cozinha");

  await p.getByTestId("open-budget").click(); await p.waitForTimeout(800);
  await p.getByTestId("room-list").scrollIntoViewIfNeeded(); await shot("16-quantitativos-e-ambientes");
  const rooms = await p.locator("[data-testid=room-list] tbody tr").allInnerTexts();
  fs.writeFileSync(path.join(OUT, "lista-de-ambientes.txt"), rooms.map((r) => r.replace(/\t+/g, " | ")).join("\n"));
  const rows = await p.locator("[data-testid=takeoff-table] tbody tr").allInnerTexts();
  fs.writeFileSync(path.join(OUT, "quantitativos.txt"), rows.map((r) => r.replace(/\t+/g, " | ")).join("\n"));
  await p.getByTestId("budget-tab-orcamento").click(); await p.getByTestId("load-example-prices").click(); await p.waitForTimeout(500);
  await p.getByTestId("save-budget-version").click(); await shot("17-orcamento-demonstrativo");
  await p.getByTestId("budget-tab-proposta").click();
  await p.getByTestId("company-name").fill("Atlas Construções (DEMONSTRAÇÃO)"); await p.getByTestId("company-email").fill("demo@exemplo.com.br");
  await p.getByTestId("client-name").fill("Cliente de Demonstração"); await p.getByTestId("client-add").click(); await p.waitForTimeout(300);
  await p.getByTestId("budget-close").click(); await p.getByTestId("view-3d").click(); await p.getByTestId("view-3d").click();
  await p.keyboard.press("f"); await p.waitForTimeout(1500);
  await p.getByTestId("open-budget").click(); await p.getByTestId("budget-tab-proposta").click(); await p.getByTestId("capture-image").click();
  await p.getByTestId("budget-close").click(); await p.getByTestId("view-dollhouse").click(); await p.waitForTimeout(1500);
  await p.getByTestId("open-budget").click(); await p.getByTestId("budget-tab-proposta").click(); await p.getByTestId("capture-image").click();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("generate-pdf").click()]);
  await dl.saveAs(path.join(OUT, "proposta-comercial-demonstrativa.pdf")); await shot("18-proposta");
  console.log(errs.length ? "ERROS: " + errs.slice(0, 3).join(" | ") : "sem erros de console");
  await b.close();
})();
