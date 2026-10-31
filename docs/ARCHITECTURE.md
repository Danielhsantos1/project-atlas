# Arquitetura e decisões — PROJECT ATLAS

## Camadas

```
UI (features/*, ui/*)            React, Tailwind, R3F/Three.js, SVG
  │  lê estado / despacha ações
Estado de aplicação (Zustand)     features/editor/store.ts, features/projects/store.ts
  │  chama funções puras
Domínio (core/*)                  schemas, fábrica, operações, geometria, unidades — sem dependência de UI
  │
Persistência (persistence/*)      ProjectService → ProjectRepository (interface) → KeyValue/localStorage
```

Regra de dependência: `core` não importa nada de `features`, `persistence`, React ou Three.js.

## Decisões arquiteturais (ADRs)

### ADR-001 — Modelo único, visualizações derivadas
O documento do projeto é um array de elementos (`Project.elements`). O viewport 3D e a planta 2D apenas
**leem** esse array e chamam as mesmas funções de geometria (`computeWallPieces`, `wallPlanCut`,
`computeWallJoins`, `objectParts`). Não existe estado geométrico próprio de nenhuma das vistas.
*Consequência:* qualquer alteração (painel, gizmo 3D, arraste 2D, teclado) aparece nas duas vistas.

### ADR-002 — Metros, Z para cima, conversão na borda
O domínio usa metros e o sistema CAD (X leste, Y norte, Z cota). O Three.js usa Y para cima; a conversão
(`toThree`/`fromThree` em `core/geometry/vec.ts`) acontece somente nos componentes de renderização.
Unidades de exibição (m/cm/mm) são apenas formatação.

### ADR-003 — Aberturas reais por decomposição, não CSG
Portas e janelas são elementos hospedados (`hostId`, `offset` ao longo do eixo). A parede é fatiada nas bordas
das aberturas e cada fatia recebe os intervalos verticais sólidos restantes (`computeWallPieces`).
É exato, determinístico, barato e testável, e o mesmo resultado alimenta 3D, corte 2D e quantitativos.
CSG genérico (ex.: three-bvh-csg) foi descartado nesta fase: mais caro, menos previsível e difícil de testar.

### ADR-004 — Juntas de paredes
Cantos: a primeira parede (ordem do projeto) avança meia espessura da outra; a outra recua meia espessura da
primeira — o quadrado do canto é coberto uma única vez (sem frestas e sem z-fighting). Encontros em T:
a parede que chega recua. Ao mover/alterar uma parede, extremidades coincidentes de outras paredes
acompanham (`setWallEndpoints`), como paredes unidas em ferramentas BIM.

### ADR-005 — Schemas Zod como fonte única
Tipos TypeScript são inferidos dos schemas (`core/model/schema.ts`). Os mesmos schemas validam
operações de edição, importação de arquivos e leitura do armazenamento.

### ADR-006 — Operações puras + histórico por snapshots
`core/model/operations.ts` recebe um projeto e devolve outro (imutável). O store guarda snapshots
(compartilhamento estrutural) para desfazer/refazer. Um arraste completo vira **um** passo de histórico.
Erros de regra lançam `DomainError` (mensagem ao usuário); erros inesperados são relançados — nunca engolidos.

### ADR-007 — Persistência isolada e versionada
`ProjectRepository` é assíncrono para permitir uma implementação HTTP/PostgreSQL sem mudar consumidores.
Cada documento é gravado num envelope `{ format: "atlas.project", version, savedAt, project }`.
Para evoluir o formato: incrementar `CURRENT_FORMAT_VERSION`, registrar a migração em `MIGRATIONS` e testar com
um documento real da versão anterior. Versões futuras desconhecidas são rejeitadas com mensagem clara.
O índice guarda resumos (com miniatura derivada da geometria) para listar projetos sem carregá-los inteiros.

### ADR-008 — Autosave por revisão
Cada alteração incrementa `revision`. O autosave grava após 1 s de inatividade e registra a revisão salva;
edições feitas durante a gravação mantêm o estado "não salvo" e disparam novo ciclo. Ao sair do editor,
alterações pendentes são gravadas (com captura síncrona do snapshot).

### ADR-009 — Rótulos 3D como camada DOM projetada
Rótulos de medida não usam `<Html>` do Drei (cria uma raiz React por rótulo; com React 19 + StrictMode gerou
erros de desmontagem). Uma camada DOM fora do canvas é posicionada por um projetor `useFrame`.

### ADR-010 — Objetos paramétricos por primitivas
Itens da biblioteca são especificações (dimensões + tipo). `objectParts()` decompõe cada tipo em caixas e
cilindros em coordenadas locais; o 3D desenha volumes e a planta desenha as projeções das mesmas peças.

## Pontos de extensão

- `src/modules/contracts.ts`: `QuantityProvider`, `ProjectExporter`, `AtlasModuleInfo`.
- `src/modules/registry.ts`: módulos ativos/planejados e suas dependências (testadas).
- Novo tipo de objeto: adicionar em `OBJECT_KINDS`, implementar em `objectParts()` e cadastrar na biblioteca
  (o teste de objetos garante que todo tipo tem item e que as peças cabem na caixa envolvente).
- Novo tipo de elemento (ex.: viga): schema em `schema.ts` + operações + renderizadores 3D/2D + migração de formato.

## Preparação para SaaS (não implementado)

- Identificadores UUID gerados no cliente (compatíveis com chaves primárias no PostgreSQL).
- Envelope versionado pronto para trafegar via API.
- Ainda faltam: `ownerId`/`organizationId` no projeto (entrará com migração v1→v2 quando houver autenticação).

## Segurança e responsabilidade técnica

Os quantitativos e geometrias são indicativos. Nada nesta versão substitui cálculo, dimensionamento ou
verificação normativa por profissional habilitado.
