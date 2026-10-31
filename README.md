# PROJECT ATLAS

Plataforma web de **arquitetura, engenharia, construção civil, modelagem 3D e fabricação sob medida**.
Esta é a **v0.1 (Missão 001)**: um editor paramétrico funcional em que planta 2D e modelo 3D
compartilham **um único modelo de dados**.

> Estado: protótipo funcional para uso local. Os dados ficam no navegador (localStorage).
> Não há autenticação, servidor nem cobrança nesta versão.

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
| `npm run e2e` | Teste de aceitação no navegador (requer app rodando + Playwright) |

Para o teste ponta a ponta, instale o Playwright uma vez:

```bash
npm i -D playwright && npx playwright install chromium
```

Com a aplicação rodando em outro terminal, execute `npm run e2e`
(ou `BASE_URL=http://localhost:4000 npm run e2e`). Capturas de tela ficam em `e2e-artifacts/`.

---

## Funcionalidades implementadas (v0.1)

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

- **78 testes unitários** (Vitest): unidades, geometria de paredes e aberturas, juntas, snap, criação de objetos,
  alteração de propriedades, operações, quantitativos, salvamento, recuperação, exportação/importação, migrações,
  erros de armazenamento e fluxo do editor (store).
- **Teste de aceitação no navegador** (`npm run e2e`): os 14 critérios da Missão 001, executados em Chromium real com WebGL.

## Limitações conhecidas

- Dados apenas no navegador atual (limpar dados do site apaga os projetos — exporte JSON para backup).
- Paredes retas apenas; pisos retangulares; um único pavimento.
- Quantitativos são geométricos e indicativos. **Nenhum cálculo desta versão é validado para fins de engenharia
  ou normas técnicas** (ex.: dimensionamento de escadas, estruturas, instalações).
- Editor otimizado para desktop (mouse + teclado).

Veja o plano de evolução em [`ROADMAP.md`](ROADMAP.md).
