# ATLAS BUDGET

Quantitativos e orçamento **derivados da geometria** — não há calculadora desconectada do modelo.

## Fluxo
`Project` → `takeoff()` (linhas com memória de cálculo) → `buildBudget()` (preços do banco, fator regional, BDI) →
`Proposal` (margem, desconto, condições; orçamento CONGELADO) → `generateProposalPdf()`.

## Regras principais
- Paredes: área líquida (descontadas as aberturas reais) por núcleo construtivo; reboco 2 faces; pintura (demãos e rendimento editáveis); tinta em litros.
- Ambientes: piso por material com perda (%) editável; forro. Lajes: volume. Telhados: área inclinada + cumeeira. Esquadrias: contagem por dimensão/material.
- Objetos: estrutura em volume; móveis planejados, louças, equipamentos e paisagismo em unidades; piscina por espelho d'água.
- **Parâmetros de referência são editáveis e não normativos.**

## Preços (nunca inventados)
- Cada preço tem **fonte, data, unidade, região** e componentes (material, mão de obra, equipamento).
- Sem preço → a linha é sinalizada "Preencher preço" e **fica fora do total** (nunca vira zero silencioso).
- Preços de **EXEMPLO** (botão explícito) são marcados no orçamento, na proposta e no PDF.
- Preço com mais de 365 dias é marcado como desatualizado. Fornecedores e fatores regionais cadastráveis.
- Importação CSV no formato SINAPI (`;`, vírgula decimal) cria itens "a vincular". `PriceSourceProvider` documenta integrações oficiais futuras (nenhuma chamada de rede hoje).

## Versionamento
`projectRevisionHash` (FNV-1a de pavimentos, elementos e configurações) vincula orçamentos e propostas à **versão exata** do projeto;
a interface avisa quando o projeto mudou depois do orçamento salvo.

## Aviso
Estimativa gerada a partir do modelo. Não substitui orçamento executivo nem projeto técnico aprovado.
