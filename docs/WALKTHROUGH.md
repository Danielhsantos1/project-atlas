# Passeio 3D em primeira pessoa (Missão 004)

Botão **Entrar na construção** (barra de modos). Posiciona o usuário fora da porta de entrada principal.

## Controles
`W A S D` mover · mouse olhar (Pointer Lock; sem ele, arrastar na cena) · `Shift` correr · `Espaço` pular ·
`E` abrir/fechar porta · `L` luzes · `Esc` soltar o mouse. Botões direcionais na tela para iniciantes.
Interface: sair da construção, reiniciar na entrada, ir para um pavimento, qualidade gráfica, altura dos olhos (padrão 1,65 m).

## Arquitetura (`src/walkthrough`, TypeScript puro)
- **Colisão derivada do modelo** — `buildCollisionWorld(project, doorOpen)` monta caixas orientadas a partir das MESMAS paredes
  (`computeWallPieces`, inclusive vãos reais de portas e janelas), pisos/lajes, objetos (`objectParts`) e degraus da escada.
  Não existe cópia da construção: mover uma parede, inserir uma porta ou alterar a escada muda a colisão na próxima reconstrução.
- **Separação visual × física**: o mundo físico usa caixas simples e um *spatial hash* de 2 m; a geometria visual não é consultada.
- **Controlador** — cilindro (raio 0,25 m, altura 1,75 m), gravidade, subida/descida de degraus até 0,35 m, teto bloqueia a cabeça,
  verificação por varredura impede atravessar lajes ao cair, sub-passos de até 5 cm evitam "tunelamento".
- **Portas**: porta de giro/correr fechada bloqueia (preenche o vão); aberta deixa o vão real passável; vão livre nunca bloqueia.
  Janelas sempre bloqueiam (inclusive porta-janela). Animação visual segue o estado físico.
- **Pavimentos**: lajes sustentam o piso; o vão da escada é um buraco real. Ambientes de pavimentos sem laje modelada ganham piso físico.
- **Desempenho**: consulta espacial por célula, sub-passos adaptativos, qualidade gráfica (alta/média/baixa), geometrias e materiais compartilhados.

## Testes
`src/walkthrough` (40 testes): entrar pela porta, andar na sala, atravessar porta aberta, bater na parede por 5 s sem atravessar,
porta fechada bloqueia, subir a escada sem retroceder, caminhar no pavimento superior sem cair, descer sem ficar no ar,
sair ao jardim, pular sem atravessar a laje, parede movida/porta inserida alteram a colisão — num sobrado de teste **e** na residência demonstrativa.

## Limitações
Folhas de porta abertas não colidem; cilindros são aproximados por caixas; terreno plano em z = 0; telhado inclinado não é caminhável;
sem aceleração/controle no ar; interruptores e janelas interativos só existem como tipos (ainda não modelados).
