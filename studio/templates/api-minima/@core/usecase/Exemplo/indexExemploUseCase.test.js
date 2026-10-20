const IndexExemploUseCase = require('./indexExemploUseCase');

describe('IndexExemploUseCase', () => {
  test('executar aceita um input', async () => {
    const caso = new IndexExemploUseCase();
    const out = await caso.executar({ ping: true });
    expect(out.status).toBe(true);
    expect(out.msg).toBe('exemplo ok');
  });

  test('executar exige dados', async () => {
    const caso = new IndexExemploUseCase();
    const out = await caso.executar(null);
    expect(out.status).toBe(false);
    expect(out.msg).toBe('Dados obrigatorios');
  });
});
