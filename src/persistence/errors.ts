/** Falha de leitura/gravação/formato. Sempre propagada até a interface com mensagem clara. */
export class PersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PersistenceError";
  }
}
