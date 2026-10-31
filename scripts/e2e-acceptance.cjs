/**
 * Teste de aceitação ponta a ponta (critérios da Missão 001) em navegador real.
 *
 * Pré-requisitos: aplicação rodando (npm run dev ou npm run build && npm start)
 * e Playwright com Chromium disponível (npm i -D playwright && npx playwright install chromium).
 *
 * Uso: npm run e2e            (BASE_URL padrão: http://localhost:3000)
 *      BASE_URL=http://localhost:4000 npm run e2e
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
const OUT = path.join(__dirname, "..", "e2e-artifacts");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(n, label, ok, detail = "") {
  results.push({ n, label, ok });
  console.log(`${ok ? "✔" : "✘"} ${String(n).padStart(2)}. ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`Critério ${n} falhou: ${label} ${detail}`);
}

async function counts(page) {
  const text = await page.getByTestId("element-counts").innerText();
  const get = (label) => Number(new RegExp(`${label} (\\d+)`).exec(text)?.[1] ?? NaN);
  return { walls: get("Paredes"), doors: get("Portas"), windows: get("Janelas"), floors: get("Pisos") };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  try {
    // 1–2. Aplicação executa e dashboard abre (armazenamento limpo).
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Seu estúdio de projetos" }).waitFor();
    check(1, "Aplicação executa localmente", true, BASE);
    check(2, "Dashboard abre", true);
    await page.screenshot({ path: path.join(OUT, "01-dashboard.png") });

    // 3. Criar projeto residencial.
    await page.getByTestId("new-project").click();
    await page.getByTestId("project-name-input").fill("Residência Aceite E2E");
    await page.getByTestId("category-residencial").click();
    await page.getByTestId("create-project-submit").click();
    await page.waitForURL(/\/editor\//);
    const editorUrl = page.url();
    check(3, "Projeto residencial criado", true, editorUrl.split("/").pop());

    // 4. Editor 3D abre com WebGL.
    await page.getByTestId("viewport-3d").locator("canvas").waitFor();
    await page.waitForTimeout(1200);
    const hasGL = await page.evaluate(() => {
      const c = document.querySelector("[data-testid=viewport-3d] canvas");
      return !!c && !!(c.getContext("webgl2") || c.getContext("webgl"));
    });
    check(4, "Editor 3D abre (canvas WebGL)", hasGL);

    // 5. Quatro paredes com a ferramenta Ambiente, na planta 2D.
    await page.getByTestId("view-2d").click();
    const plan = page.getByTestId("viewport-2d");
    await plan.locator("svg.plan-svg").waitFor();
    await page.waitForTimeout(400);
    const box = await plan.locator("svg.plan-svg").boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const A = { x: cx - 220, y: cy + 160 };
    const B = { x: cx + 220, y: cy - 160 };
    await page.getByTestId("room-sala").click();
    await page.mouse.move(A.x, A.y);
    await page.mouse.click(A.x, A.y);
    await page.mouse.move(B.x, B.y, { steps: 5 });
    await page.mouse.click(B.x, B.y);
    let c = await counts(page);
    check(5, "Quatro paredes criadas", c.walls === 4, `paredes=${c.walls}, pisos=${c.floors}`);

    // 6. Modificar dimensões da parede sul (selecionando na planta).
    await page.getByTestId("tool-select").click();
    await page.mouse.click(cx, A.y);
    await page.getByTestId("selected-name").waitFor();
    const selName = await page.getByTestId("selected-name").innerText();
    await page.getByTestId("prop-height").fill("3,1");
    await page.getByTestId("prop-height").press("Enter");
    await page.getByTestId("prop-thickness").fill("20cm");
    await page.getByTestId("prop-thickness").press("Enter");
    await page.getByTestId("prop-length").fill("7,5");
    await page.getByTestId("prop-length").press("Enter");
    await page.waitForTimeout(200);
    const dims = {
      length: await page.getByTestId("prop-length").inputValue(),
      height: await page.getByTestId("prop-height").inputValue(),
      thickness: await page.getByTestId("prop-thickness").inputValue(),
    };
    check(6, "Dimensões modificadas", dims.length === "7,500" && dims.height === "3,100" && dims.thickness === "0,200", `${selName}: ${JSON.stringify(dims)}`);

    // 7. Porta na parede selecionada.
    await page.getByTestId("lib-door-90").click();
    c = await counts(page);
    check(7, "Porta inserida", c.doors === 1, (await page.getByTestId("selected-name").innerText()));

    // 8. Janela: ferramenta Janela + clique sobre a parede norte.
    await page.keyboard.press("Escape");
    await page.getByTestId("tool-window").click();
    await page.mouse.click(cx - 60, B.y);
    c = await counts(page);
    check(8, "Janela inserida", c.windows === 1, await page.getByTestId("selected-name").innerText());

    // 9. Aberturas visíveis: a planta mostra o vão (dois trechos de parede por abertura).
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const polysPerWall = await page.evaluate(() =>
      [...document.querySelectorAll("[data-testid=viewport-2d] g[data-el]")]
        .map((g) => [...g.querySelectorAll(":scope > polygon")])
        .filter((ps) => ps.length > 1 && ps.every((p) => p.getAttribute("fill") !== "transparent")).length,
    );
    await page.screenshot({ path: path.join(OUT, "02-planta-2d.png") });
    check(9, "Aberturas visíveis (paredes interrompidas no corte)", polysPerWall >= 2, `${polysPerWall} paredes com vão`);

    // 10. Resultado em 3D.
    await page.getByTestId("view-3d").click();
    await page.getByTestId("viewport-3d").locator("canvas").waitFor();
    await page.keyboard.press("f");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "03-modelo-3d.png") });
    check(10, "Resultado visualizado em 3D", true, "03-modelo-3d.png");

    // 11. Planta baixa com cotas.
    await page.getByTestId("view-2d").click();
    await page.waitForTimeout(500);
    const dimTexts = await page.locator("[data-testid=viewport-2d] text").allTextContents();
    check(11, "Planta baixa com cotas", dimTexts.some((t) => t.includes("7,50 m")), `${dimTexts.length} textos`);

    // 12. Salvar (Ctrl+S) e confirmar estado salvo.
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => document.querySelector("[data-testid=save-status]")?.getAttribute("data-status") === "saved");
    const before = await counts(page);
    check(12, "Projeto salvo", true, JSON.stringify(before));

    // 13. Fechar (voltar ao dashboard) e abrir novamente (recarga completa).
    await page.getByTestId("back-to-dashboard").click();
    await page.waitForURL(BASE + "/");
    await page.getByTestId("project-card").first().waitFor();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: "Abrir Residência Aceite E2E" }).click();
    await page.waitForURL(/\/editor\//);
    await page.getByTestId("element-counts").waitFor();
    check(13, "Projeto fechado e reaberto", page.url() === editorUrl);

    // 14. Nada perdido: contagens e dimensões da parede editada.
    const after = await counts(page);
    await page.getByTestId("view-2d").click();
    await page.waitForTimeout(500);
    const texts = await page.locator("[data-testid=viewport-2d] text").allTextContents();
    const same = JSON.stringify(before) === JSON.stringify(after);
    check(14, "Projeto recuperado sem perda", same && texts.some((t) => t.includes("7,50 m")), JSON.stringify(after));

    if (errors.length) console.warn("\nErros de console:", errors);
    console.log(`\n${results.filter((r) => r.ok).length}/14 critérios aprovados. Capturas em e2e-artifacts/`);
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, "falha.png") });
    console.error("\n" + e.message);
    if (errors.length) console.error("Erros de console:", errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
