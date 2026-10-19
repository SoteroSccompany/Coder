'use strict';

/**
 * Gateway redis — gerado pelo Coder Studio.
 * Le somente variaveis de ambiente. Nao grave segredos neste arquivo.
 */
function criar() {
    return {
        id: 'redis',
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT || 6379),
        REDIS_PASS: process.env.REDIS_PASS || '',
    };
}

module.exports = { criar };
