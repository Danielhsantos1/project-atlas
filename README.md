# PROJECT ATLAS

Plataforma web de **arquitetura, engenharia, construção civil, modelagem 3D e fabricação sob medida**.
Versão **v0.3** (Missões 001, 003 e 004): construtor de casas visual, planta 2D e 3D sobre **um único modelo
de dados**, passeio em primeira pessoa, quantitativos, orçamento e proposta comercial em PDF.

> Estado: protótipo funcional. Os dados ficam no navegador (localStorage).
> Não há autenticação, servidor nem cobrança. Nenhum cálculo é validado para fins de engenharia.

---

## Requisitos

- Node.js **20.9+** (testado com Node 22)
- npm 10+
- Navegador com WebGL 2 (Chrome, Edge, Firefox, Safari recentes)

## Instalação e execução

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>.

Build de produção:

```bash
npm run build
npm start
```

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento (Turbopack) |
| `npm run build` | Build de produção (inclui checagem de tipos) |
| `npm start` | Serve o build de produção |
| `npm test` | Testes unitários (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run e2e` | Aceitação da Missão 001 no navegador (app rodando + Playwright) |
| `npm run e2e:m3` | Aceitação das Missões 003/004 no navegador (19 verificações) |
| `npm run demo` | Gera o pacote demonstrativo (imagens, PDF, listas) em `e2e-artifacts/demo-residencia-moderna/` |

Para o teste ponta a ponta, instale o Playwright uma vez:

```bash
npm i -D playwright && npx playwright install chromium
```

Com a aplicação rodando em outro terminal, execute `npm run e2e`
(ou `BASE_URL=http://localhost:4000 npm run e2e`). Capturas de tela ficam em `e2e-artifacts/`.

---

## Novidades da v0.3 (Missões 003 e 004)

- **ATLAS HOME BUILDER**: tela inicial com *Criar minha casa*, *Começar do zero*, *Escolher um modelo*,
  *Abrir projeto*, *Projeto comercial* e *Ambientes internos*.
- **Cômodos como elementos reais**: a paleta "Construir cômodos" (sala, cozinha, quarto, suíte, banheiro, garagem, gourmet…)
  cria paredes + ambiente. Cômodos encostados **compartilham a parede**; a área útil, o perímetro e o piso são **derivados das paredes**
  (mover uma parede atualiza todos os ambientes vizinhos). Largura/profundidade editáveis no painel; uma fachada contínua se move junta.
- **Pavimentos**: vários níveis, seletor visual, planta de cada nível (com o nível inferior como referência).
- **Telhados** (1, 2 e 4 águas, laje plana), **vão livre**, **porta de correr**, **muros**, **vigas**, **jardim/piscina/árvores**.
  Biblioteca com **52 itens** (cozinha, sala, quarto, banheiro, externo, estrutura).
- **Modos de visualização** (todos derivados do mesmo modelo): casa completa · casa aberta (dollhouse) · planta · corte horizontal/vertical ·
  construção em **8 etapas** (terreno → projeto finalizado) · fachadas ortogonais (4 lados) · interiores por cômodo · passeio 3D.
- **Passeio 3D em primeira pessoa** (Missão 004): ver [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md).
- **ATLAS BUDGET**: quantitativos extraídos da geometria, lista de ambientes, banco de preços editável (fonte, data, unidade, região),
  fornecedores, importação CSV no formato SINAPI, orçamento por categoria com BDI, versões vinculadas à revisão do projeto e
  **proposta comercial em PDF** (empresa, cliente, imagens, quantitativos, condições). Ver [`docs/BUDGET.md`](docs/BUDGET.md).
- **ATLAS AI**: descreva a casa em português e receba um estudo editável. Interpretador **local por regras** (sem envio de dados),
  gerador de layout e verificador de inconsistências. Nunca apresenta o resultado como aprovado tecnicamente.
- **Base SaaS** (`src/saas`): papéis, permissões, isolamento por organização, planos e limites — regras puras e testadas; sem login nem cobrança.
- **Modelo demonstrativo**: *Residência moderna de dois pavimentos* (Home Builder → Escolher um modelo).

## Funcionalidades da v0.1

### Dashboard e gerenciamento de projetos
- Visão geral com indicadores **reais** (projetos, em andamento, favoritos, elementos modelados, ações em 7 dias).
- Projetos recentes com **miniatura de planta gerada a partir da geometria** (não é imagem salva).
- Criar projeto: nome, categoria (9 categorias), dimensões do terreno, pé-direito padrão, descrição.
- Abrir, renomear, favoritar, marcar como concluído/reabrir, **duplicar**, **excluir com confirmação**.
- Biblioteca de projetos com filtros (todos, favoritos, em andamento, concluídos), busca, categoria e ordenação.
- Exportar/importar **JSON versionado** (importação sempre cria um novo projeto).
- Histórico de atividade (criou, abriu, salvou, duplicou, exportou, importou, excluiu).

### Editor
- **Viewport 3D** (Three.js + React Three Fiber): grade, eixos X/Y/Z, câmera em perspectiva, órbita, pan, zoom,
  vistas (enquadrar, perspectiva, superior, frontal, lateral) com transição suave, cubo de orientação.
- **Planta baixa 2D** (SVG): corte a 1,20 m, paredes com vãos, símbolos de porta (folha + arco) e janela,
  cotas das paredes, cotas parciais das aberturas da parede ativa, grade adaptativa, escala gráfica e numérica, norte, zoom e pan.
- Seleção (3D e 2D), destaque, **gizmo de translação** (3D), arraste com snap (2D), setas do teclado.
- Indicadores de medida no 3D e na planta.
- **Desfazer/refazer** (150 passos), autosave com controle de alterações, salvamento manual.
- Painéis laterais recolhíveis, barra de status com coordenadas, snap, unidade e contagens.

### Construção arquitetônica
- **Paredes**: desenho encadeado por cliques ou **comprimento digitado** (estilo CAD, com rastreamento polar de 15°),
  modo ortogonal (Shift), snap em extremidades e grade, ferramenta **Ambiente** (4 paredes + piso).
  Comprimento, altura, espessura, cota da base, ângulo, posição e material editáveis.
  **Juntas**: cantos e encontros em T resolvidos geometricamente; mover/alterar uma parede arrasta as paredes unidas.
- **Portas e janelas** hospedadas em paredes, com **abertura geométrica real** (a parede é decomposta em blocos
  sólidos; o vão fica vazio no 3D, no corte 2D e nos quantitativos). Largura, altura, peitoril, posição no eixo,
  dobradiça e sentido de abertura editáveis; validação (fora da parede, mais alta que a parede, sobreposição).
- **Pisos/lajes**: dimensões, espessura, cota, rotação e material.
- **Biblioteca** com 30 itens paramétricos: paredes, portas, janelas, pisos, colunas, escada, móveis,
  bancadas, armários e louças sanitárias — todos com propriedades editáveis.
- **Quantitativos geométricos**: área bruta/líquida e volume de paredes, área/volume de pisos.

### Atalhos
`V` selecionar · `W` parede · `A` ambiente · `P` piso · `D` porta · `J` janela · `1`/`2` 3D/planta ·
`F` enquadrar · `T` superior · `I` perspectiva · `R` girar 90° · setas mover · `Ctrl+Z`/`Ctrl+Shift+Z` ·
`Ctrl+S` · `Ctrl+D` · `Del` · `Esc` · `G` snap · `[` `]` painéis · `?` lista completa.

---

## Arquitetura (resumo)

Detalhes e decisões em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
src/
├── app/                    Rotas Next.js (App Router): /, /projects, /editor/[id]
├── ai/                     ATLAS AI: interpretador local, gerador de layout, verificador
├── budget/                 ATLAS BUDGET: quantitativos, preços, orçamento, proposta, PDF, repositório
├── saas/                   Papéis, permissões, planos e limites (sem backend)
├── walkthrough/            Passeio 3D: colisão derivada do modelo, controlador, interação (sem React/Three)
├── core/                   NÚCLEO DE DOMÍNIO — TypeScript puro, sem React/Three
│   ├── units/              Unidades (m/cm/mm), formatação pt-BR, parse de medidas
│   ├── geometry/           Vetores, paredes com aberturas, juntas, snap, formas, objetos paramétricos
│   ├── model/              Schemas Zod (fonte única de tipos), fábrica, operações puras, materiais
│   └── library/            Catálogo de objetos paramétricos
├── persistence/            Repositório (interface assíncrona), formato versionado, migrações, atividade
├── modules/                Contratos de extensão e registro dos módulos futuros
├── features/
│   ├── dashboard/          Visão geral
│   ├── projects/           Biblioteca, cards, criação, store de projetos
│   ├── shell/              Layout com navegação
│   └── editor/             Store do editor, viewport 3D, planta 2D, painéis, atalhos, autosave
├── ui/                     Componentes visuais reutilizáveis
└── lib/                    Utilitários
scripts/e2e-acceptance.cjs  Teste de aceitação ponta a ponta
```

Princípios:
1. **Um único modelo.** 2D e 3D são *visualizações* derivadas do mesmo array de elementos.
2. **Domínio em metros**, eixo Z para cima (convenção CAD). A conversão para o Three.js (Y para cima) só ocorre na borda de renderização.
3. **Operações puras e validadas** (`core/model/operations.ts`): projeto → novo projeto. Viabiliza desfazer/refazer e testes.
4. **Persistência atrás de uma interface** (`ProjectRepository`) — trocar localStorage por API + PostgreSQL não afeta o editor.

## Testes

- **186 testes unitários** (Vitest): unidades, geometria de paredes e aberturas, juntas, snap, criação de objetos,
  alteração de propriedades, operações, quantitativos, salvamento, recuperação, exportação/importação, migrações,
  erros de armazenamento e fluxo do editor (store).
- **Aceitação no navegador** (Chromium real com WebGL): `npm run e2e` (14 critérios da Missão 001) e `npm run e2e:m3`
  (Home Builder, IA, modelo demonstrativo, todos os modos, alteração de cômodo com atualização de quantitativos,
  passeio 3D com porta fechada/aberta, orçamento e PDF).

## Limitações conhecidas

- Dados apenas no navegador atual (limpar dados do site apaga os projetos — exporte JSON para backup).
- Paredes retas apenas; pisos e telhados retangulares. Sem instalações elétricas/hidráulicas e sem estrutura calculada.
- Preços: **nenhum preço real é fornecido**. Os dados de exemplo são identificados como tal no orçamento e no PDF.
- O passeio 3D não modela folhas de porta aberta como obstáculo e aproxima cilindros por caixas.
- ATLAS AI é um interpretador de regras (não um modelo de linguagem); entende pedidos simples em português.
- Quantitativos são geométricos e indicativos. **Nenhum cálculo desta versão é validado para fins de engenharia
  ou normas técnicas** (ex.: dimensionamento de escadas, estruturas, instalações).
- Editor otimizado para desktop (mouse + teclado).

Veja o plano de evolução em [`ROADMAP.md`](ROADMAP.md).
