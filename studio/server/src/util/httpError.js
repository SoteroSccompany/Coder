'use strict';

/**
 * Erro HTTP com status e codigo estavel (consumido pela UI).
 * O middleware de erro em `src/app.js` converte para JSON: { error, code, ...details }.
 */
class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Atalhos comuns. */
HttpError.badRequest = (code, msg, d) => new HttpError(400, code, msg, d);
HttpError.forbidden = (code, msg, d) => new HttpError(403, code, msg, d);
HttpError.notFound = (code, msg, d) => new HttpError(404, code, msg, d);
HttpError.conflict = (code, msg, d) => new HttpError(409, code, msg, d);

module.exports = { HttpError };
