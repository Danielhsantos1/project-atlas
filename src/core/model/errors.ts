/** Erro de regra de domínio: mensagem pensada para ser exibida ao usuário. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
