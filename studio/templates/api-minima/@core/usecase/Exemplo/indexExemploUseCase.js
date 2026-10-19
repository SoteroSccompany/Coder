class IndexExemploUseCase {
  async executar(input) {
    if (!input) return { status: false, msg: 'Dados obrigatorios' };
    return { status: true, msg: 'exemplo ok', name: '{{name}}' };
  }
}

module.exports = IndexExemploUseCase;
