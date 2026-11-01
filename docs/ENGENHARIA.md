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
