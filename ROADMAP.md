# ROADMAP — PROJECT ATLAS

Legenda: ✅ entregue e testado · 🔜 próxima etapa · 📋 planejado

## v0.1 — Missão 001 (entregue)

- ✅ Estrutura Next.js + TypeScript + Tailwind + Zustand + Zod + Vitest
- ✅ Identidade visual (tema grafite, azul elétrico, Geist)
- ✅ Dashboard com indicadores reais e atividade
- ✅ Gerenciador de projetos (criar, abrir, renomear, favoritar, status, duplicar, excluir, filtros)
- ✅ Editor 3D: grade, eixos, câmera, órbita/pan/zoom, vistas, seleção, gizmo, medidas
- ✅ Paredes (cliques, comprimento digitado, ortogonal, snap, juntas), ferramenta Ambiente
- ✅ Portas e janelas com abertura geométrica real e validação
- ✅ Pisos, biblioteca paramétrica (30 itens), materiais
- ✅ Planta 2D sincronizada (mesmo modelo), cotas, escala
- ✅ Desfazer/refazer, autosave com controle de revisão, exportação/importação JSON versionada
- ✅ 78 testes unitários + teste de aceitação E2E (14/14)

## v0.3 — Missões 003 e 004 (entregue)

- ✅ Modelo v2 (pavimentos, ambientes derivados, telhados, vão livre, porta de correr) com migração v1→v2
- ✅ ATLAS HOME BUILDER, paleta de cômodos, pavimentos, 8 modos de visualização, 52 itens de biblioteca
- ✅ Passeio 3D com colisão, gravidade, escadas, portas e pavimentos
- ✅ ATLAS BUDGET (quantitativos, preços, orçamento versionado, proposta PDF)
- ✅ ATLAS AI local (interpretador, gerador, verificador) e base SaaS (papéis, permissões, planos)
- ✅ Residência moderna de dois pavimentos (modelo demonstrativo) + pacote de entregáveis
- ✅ 186 testes unitários + 2 suítes de aceitação no navegador

## v0.2 — Robustez do editor 🔜

- 🔜 Seleção múltipla (Shift+clique, caixa de seleção) e operações em lote
- 🔜 Edição direta por alças: arrastar extremidades de parede, redimensionar pisos/objetos
- 🔜 Copiar/colar entre projetos
- 🔜 Ajustes finos de snap: ponto médio, perpendicular, interseção; rastreamento polar configurável
- 🔜 Cota editável na planta (clicar na cota e digitar a medida)
- 🔜 Paredes curvas e pisos poligonais (contorno a partir de paredes)
- 🔜 Rotação no gizmo 3D
- 🔜 Otimização: memoização por parede (hoje toda alteração recalcula juntas de todas as paredes), instancing de objetos repetidos
- 🔜 Testes de componentes (React Testing Library) e E2E no CI

## v0.3 — BIM básico 📋

- 📋 Pavimentos/níveis e cortes/elevações gerados do modelo
- 📋 Classificação IFC dos elementos e propriedades técnicas
- 📋 Exportação IFC, DXF (planta) e glTF/OBJ (3D)
- 📋 Importação de DXF como referência
- 📋 Ambientes com nome, área e perímetro calculados a partir das paredes

## v0.4 — Plataforma SaaS 📋

- 📋 Backend (API) + PostgreSQL implementando `ProjectRepository` e `BudgetRepository`; aplicar `src/saas` no servidor
- 📋 Autenticação, organizações/empresas, papéis e permissões
- 📋 Sincronização e resolução de conflitos; histórico de versões no servidor
- 📋 Assinaturas e cobrança (somente com autorização explícita)
- 📋 Colaboração em tempo real

## Módulos de domínio 📋

Limites já reservados em `src/modules/registry.ts`:

| Módulo | Escopo inicial previsto |
| --- | --- |
| Engenharia estrutural | Lançamento de pilares, vigas e lajes (sem dimensionamento normativo até haver validação profissional) |
| Instalações elétricas | Pontos, circuitos, quadros, lista de materiais |
| Instalações hidráulicas | Pontos de água/esgoto, prumadas, lista de materiais |
| Marcenaria | Módulos de móveis, plano de corte de chapas |
| Marmoraria | Bancadas com recortes, aproveitamento de chapas |
| Vidraçaria / Esquadrias | Tipologias, folhas, ferragens, vidros |
| Renderização | Iluminação física, materiais PBR com texturas, imagens fotorrealistas |
| Inteligência artificial | Assistente de modelagem e geração de layouts |
| Orçamentos / Quantitativos | Composições de custo sobre `QuantityProvider` |
| Gestão de obras | Cronograma, medições, diário de obra |

## Próximos passos já identificados

- Instalações elétricas/hidráulicas (a etapa 6 da visualização de obra hoje apenas avisa que não há modelagem)
- Provedor de IA com modelo de linguagem atrás da interface `AiProvider` (chave de API e política de privacidade)
- Texturas PBR e iluminação solar por data/hora; interruptores e janelas interativos no passeio
- Folhas de porta como obstáculo; rampas; telhado com águas independentes
- Base de preços oficial (SINAPI) via importação periódica; composições de custo

## Próxima etapa recomendada

**v0.2 — edição por alças + seleção múltipla + paredes curvas/pisos poligonais.** São os maiores ganhos de
produtividade para quem já desenha no ATLAS e não exigem mudanças no formato do arquivo além de uma migração simples.
