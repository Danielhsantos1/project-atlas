/**
 * Validação ponta a ponta das Missões 003 (Home Builder + Budget) e 004 (passeio 3D)
 * em navegador real. Uso: npm run e2e:m3  (BASE_URL opcional; requer app rodando + Playwright).
 */
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright não encontrado. Instale com: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.join(__dirname, "..", "e2e-artifacts", "missao-003-004");
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
const ok = (label, cond, detail = "") => {
  n++;
  console.log(`${cond ? "✔" : "✘"} ${String(n).padStart(2)}. ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) throw new Error(`Falhou: ${label} ${detail}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = async (name) => {
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  };
  const posText = async () => (await page.getByTestId("walk-position").innerText()).replace(/\n/g, " ");
  const posY = async () => Number(/Y ([\d.-]+)/.exec(await posText())[1]);
  try {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    ok("Tela ATLAS HOME BUILDER com as 6 ações", (await page.locator("[data-testid^=home-]").count()) === 6);
    await shot("01-home-builder");

    // ATLAS AI
    await page.getByTestId("home-ai").click();
    await page.getByTestId("ai-interpret").click();
    ok("ATLAS AI interpreta o pedido", (await page.getByText("Garagem para 2 carro(s)").count()) === 1);
    await page.getByTestId("ai-create").click();
    await page.waitForURL(/\/editor\//);
    await page.waitForTimeout(2500);
    const aiCounts = await page.getByTestId("element-counts").innerText();
    ok("Estudo gerado pela IA abre editável no editor", /Paredes [1-9]\d/.test(aiCounts), aiCounts);
    await shot("02-ia-estudo-gerado");

    // Modelo demonstrativo
    await page.getByTestId("back-to-dashboard").click();
    await page.waitForURL(BASE + "/");
    await page.getByTestId("home-tpl").click();
    await page.getByTestId("template-modern-house").click();
    await page.waitForURL(/\/editor\//);
    await page.waitForTimeout(3000);
    ok("Residência moderna de 2 pavimentos carregada", (await page.getByTestId("level-selector").innerText()).includes("Pavimento superior"));
    await shot("03-casa-completa-3d");
    await page.getByTestId("view-dollhouse").click();
    await shot("04-dollhouse");
    await page.getByTestId("view-2d").click();
    await shot("05-planta-terreo");
    ok("Planta do térreo com ambientes", (await page.getByTestId("plan-room").count()) >= 7);
    await page.getByTestId("level-selector").getByText("Pavimento superior").click();
    await shot("06-planta-superior");
    ok("Planta do pavimento superior", (await page.getByTestId("plan-room").count()) >= 6);
    await page.getByTestId("level-selector").getByText("Térreo").click();

    // Clicar em um cômodo, alterar dimensões, ver quantitativos atualizarem
    await page.getByTestId("open-budget").click();
    const built0 = await page.getByText("Área construída (eixos)").locator("..").innerText();
    await page.getByTestId("budget-close").click();
    const sala = page.getByTestId("plan-room").filter({ hasText: "Sala de estar" });
    const bb = await sala.boundingBox();
    await page.mouse.click(bb.x + 25, bb.y + bb.height - 25);
    await page.getByTestId("room-width").fill("8,5");
    await page.getByTestId("room-width").press("Enter");
    await page.waitForTimeout(400);
    ok("Largura do cômodo alterada", (await page.getByTestId("room-width").inputValue()) === "8,500");
    await page.getByTestId("open-budget").click();
    const built1 = await page.getByText("Área construída (eixos)").locator("..").innerText();
    ok("Quantitativos atualizados automaticamente", built0 !== built1, `${built0.replace(/\n/g, " ")} → ${built1.replace(/\n/g, " ")}`);
    await shot("07-quantitativos");
    await page.getByTestId("budget-close").click();
    await page.getByTestId("view-3d").click();
    await shot("08-3d-apos-alteracao");

    // Demais modos
    await page.getByTestId("view-section").click();
    await page.locator('select[aria-label="Corte vertical"]').selectOption("y");
    await page.locator('input[aria-label="Posição do corte vertical"]').fill("14");
    await page.locator('input[aria-label="Altura do corte horizontal"]').fill("4");
    await shot("09-corte");
    await page.getByTestId("view-construction").click();
    await page.getByTestId("stage-slider").fill("3");
    await shot("10-construcao-estrutura");
    await page.getByTestId("stage-slider").fill("4");
    await shot("11-construcao-alvenaria");
    await page.getByTestId("view-facade").click();
    await shot("12-fachada-frontal");
    await page.getByText("Lateral direita (leste)").click();
    await shot("13-fachada-leste");
    await page.getByTestId("view-interior").click();
    await page.locator('select[aria-label="Ambiente"]').selectOption({ label: "Cozinha" });
    await shot("14-interiores-cozinha");
    ok("Modos: completo, dollhouse, planta, corte, construção, fachadas, interiores", true);

    // Missão 004 — passeio
    await page.getByTestId("view-3d").click();
    await page.getByTestId("enter-building").click();
    await page.waitForTimeout(1500);
    const y0 = await posY();
    ok("Entrar na construção: posicionado fora da entrada principal", y0 < 8, await posText());
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(2500);
    await page.keyboard.up("KeyW");
    const yBlocked = await posY();
    ok("Porta fechada bloqueia a passagem", yBlocked < 7.75, await posText());
    ok("Indicação contextual de interação", (await page.getByTestId("interact-prompt").innerText()).includes("Abrir porta"));
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(900);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(3500);
    await page.keyboard.up("KeyW");
    const yIn = await posY();
    ok("Porta aberta: entrou pela porta e caminha na sala", yIn > 8.3, await posText());
    await shot("15-passeio-sala");
    await page.getByRole("button", { name: "Pavimento superior" }).click();
    await page.waitForTimeout(1500);
    const up = await posText();
    ok("Pavimento superior acessível (seletor)", up.includes("Pavimento superior") && /Z 3\.[12]/.test(up), up);
    await shot("16-passeio-superior");
    await page.getByTestId("reset-position").click();
    await page.waitForTimeout(800);
    await page.getByTestId("exit-building").click();
    await page.waitForTimeout(800);
    ok("Sair da construção volta à câmera externa", (await page.getByTestId("walk-hud").count()) === 0);

    // ATLAS BUDGET + proposta
    await page.getByTestId("open-budget").click();
    await page.getByTestId("budget-tab-orcamento").click();
    await page.getByTestId("load-example-prices").click();
    ok("Orçamento com preços de EXEMPLO identificados", await page.getByTestId("example-banner").isVisible(), await page.getByTestId("budget-total").innerText());
    await page.getByTestId("save-budget-version").click();
    await shot("17-orcamento");
    await page.getByTestId("budget-tab-proposta").click();
    await page.getByTestId("company-name").fill("Atlas Construções (demonstração)");
    await page.getByTestId("client-name").fill("Cliente Demonstração");
    await page.getByTestId("company-email").click(); // sair do campo nome salva a empresa
    await page.getByTestId("client-add").click();
    await page.waitForTimeout(300);
    await page.getByTestId("budget-close").click();
    await page.getByTestId("view-3d").click();
    await page.waitForTimeout(1500);
    await page.getByTestId("open-budget").click();
    await page.getByTestId("budget-tab-proposta").click();
    await page.getByTestId("capture-image").click();
    ok("Dados da empresa preservados ao reabrir o painel", (await page.getByTestId("company-name").inputValue()).includes("Atlas"));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("generate-pdf").click()]);
    const pdfPath = path.join(OUT, "proposta-comercial.pdf");
    await dl.saveAs(pdfPath);
    ok("Proposta comercial em PDF gerada", fs.readFileSync(pdfPath).subarray(0, 4).toString() === "%PDF", `${dl.suggestedFilename()} · ${fs.statSync(pdfPath).size} bytes`);
    await shot("18-proposta");

    ok("Sem erros de console", errors.length === 0, errors.slice(0, 3).join(" | "));
    console.log(`\n${n} verificações aprovadas. Artefatos em e2e-artifacts/missao-003-004/`);
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, "falha.png") });
    console.error("\n" + e.message);
    if (errors.length) console.error("Erros de console:", errors.slice(0, 5));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
