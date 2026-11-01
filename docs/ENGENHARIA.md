# Engenharia de obra no PROJECT ATLAS

Módulos que ligam o modelo geométrico a cálculos de pré-dimensionamento, quantitativos e documentos.
**Tudo aqui é apoio ao profissional habilitado — nunca substitui projeto, cálculo ou ART/RRT.**

## Princípios de integridade (valem para todo o código)
1. **Rascunho técnico, não documento aprovado.** O memorial e as pranchas saem marcados
   "RASCUNHO TÉCNICO PARA REVISÃO — NÃO VALIDADO POR PROFISSIONAL HABILITADO". Campos de responsável técnico,
   CREA/CAU, ART/RRT e assinatura saem **sempre em branco**.
2. **Nenhum dado de local é inventado.** Intensidade de chuva e tensão admissível do solo (sondagem SPT) não têm valor padrão:
   sem eles, o cálculo correspondente fica **pendente** e a pendência aparece no memorial.
3. **Toda premissa é visível.** Cada resultado lista suas premissas com a origem: *informado*, *adotado* ou *referência*.
   Constantes de referência (cargas, coeficientes, traços, consumos) são editáveis e devem ser conferidas na norma vigente.
4. **Normas são citadas para consulta**, nunca declaradas como atendidas.
5. **DWG não é gerado** (formato proprietário). A exportação é **DXF**, validada por analisador independente.
6. **Os cálculos estruturais são pré-dimensionamento** (regras práticas), não análise estrutural.

## Ordem de uso recomendada
Modelo → *Engenharia* (preencher chuva e solo) → conferir premissas e pendências → memorial + pranchas DXF → revisão do engenheiro.

---

## Estado em 01/11/2026 (ponto de retomada)

**Pronto e testado (299 testes unitários passando, tipos sem erro):**
- Garagem por nº de carros, portas/janelas de tamanho livre, pé-direito por pavimento.
- `src/engineering`: telhado + calhas, caixa d'água + pressão + melhor ponto, pré-dimensionamento estrutural (53 testes).
- `src/budget/construction.ts`: levantamento completo de materiais da obra (48 testes; tijolos, argamassa, cimento, areia, brita, aço, acabamentos internos e externos).
- `src/memorial`: memorial de cálculo em PDF (rascunho técnico, assinatura sempre em branco).
- Painel **Engenharia** no editor (entradas do local, resultados, lançamento de pilares/vigas no modelo, memorial) — testado no navegador.
- CI no GitHub (tipos, testes, build).

**Pendente (retomar daqui):**
1. **Exportação DXF** (`src/export`): o agente foi interrompido no meio. Existem gerador, planta, fachadas e cortes, mas **não foram verificados nem integrados**. Falta: rodar/validar com `dxf-parser`, quadro de áreas/esquadrias e carimbo conferidos, botão de download na interface e o relatório de limitações. **Não declarar compatibilidade DXF antes disso.**
2. Ligar o **quantitativo completo de materiais** (`takeoffComplete`, `materialSummary`) ao painel de Orçamento e ao memorial (seção "Quantidade de materiais").
   Atenção: linhas de serviço e de insumo podem repetir material — precificar um nível só.
3. Revisar padrões de reboco/traço apontados pelo agente (reboco pesado: ~775 sacos de cal e ~622 de cimento na casa demonstrativa).
4. Teste de aceitação no navegador da engenharia (script e2e) e atualização do README/ROADMAP.
5. **Fase seguinte combinada:** banco de dados e login com Neon (na conta do usuário).

**Decisões de integridade mantidas:** sem DWG; chuva e solo sem valor padrão; memorial nunca assinado nem aprovado.
