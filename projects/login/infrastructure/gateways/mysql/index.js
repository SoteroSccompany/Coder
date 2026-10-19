'use strict';

/**
 * Gateway mysql — gerado pelo Coder Studio.
 * Le somente variaveis de ambiente. Nao grave segredos neste arquivo.
 */
function criar() {
    return {
        id: 'mysql',
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        DB_CLIENT: process.env.DB_CLIENT || '',
        DB_USER: process.env.DB_USER || '',
        DB_PASS: process.env.DB_PASS || '',
        DB_PASS_USER: process.env.DB_PASS_USER || '',
        DB_DATABASE: process.env.DB_DATABASE || '',
    };
}

module.exports = { criar };
