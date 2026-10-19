'use strict';

/**
 * Express 4 nao captura rejeicoes de handlers async. Envolva seus handlers:
 *   app.get('/x', asyncHandler(async (req, res) => { ... }));
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
