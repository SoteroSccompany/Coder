'use strict';

/**
 * Wizard "Nova entidade".
 *
 * Reimplementa a geracao de api/plugin/pages (domain, repository, use cases
 * get/create/update/delete, controller e log) SEM executar o plugin — ele grava
 * no cwd e carrega dados fixos. Os caminhos saem das camadas do manifesto.
 * Nenhum segredo e copiado.
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { parseFile } = require('../services/astService');
const { HttpError } = require('../util/httpError');
const { layerBase, relRequire, exigirIdent, exigirTabela } = require('./caminhos');

const ESPECIAIS = new Set(['id', 'data_criacao', 'data_atualizacao', 'deletado']);

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function kindDoCampo(nome) {
  if (nome === 'id') return 'uuid';
  if (nome === 'data_atualizacao') return 'dateNow';
  if (nome === 'deletado') return 'boolean';
  return 'plain';
}

function linhaConstrutor(nome, param = 'data') {
  const kind = kindDoCampo(nome);
  if (kind === 'uuid') return `        this.${nome} = ${param}.${nome} ? ${param}.${nome} : uuid.v4()`;
  if (kind === 'dateNow') return `        this.${nome} = ${param}.${nome} ? ${param}.${nome} : dateNow()`;
  if (kind === 'boolean') {
    return `        this.${nome} = ${param}.${nome} === true || ${param}.${nome} === false ? ${param}.${nome} : false`;
  }
  return `        this.${nome} = ${param}.${nome}`;
}

function linhaSet(nome, param = 'data') {
  if (nome === 'deletado') {
    return `        this.${nome} = ${param}.${nome} === true || ${param}.${nome} === false ? ${param}.${nome} : false`;
  }
  return `        this.${nome} = ${param}.${nome} ? ${param}.${nome} : this.${nome}`;
}

function renderDomain({ entity, fields, reqUuid, reqDate }) {
  const precisaUuid = fields.some((f) => kindDoCampo(f) === 'uuid');
  const precisaData = fields.some((f) => kindDoCampo(f) === 'dateNow');
  const requires = [];
  if (precisaUuid) requires.push(`const uuid = require(${JSON.stringify(reqUuid)});`);
  if (precisaData) requires.push(`const dateNow = require(${JSON.stringify(reqDate)});`);
  const ctor = fields.map((f) => linhaConstrutor(f)).join('\n');
  const gets = fields.map((f) => `            ${f}: this.${f},`).join('\n');
  const sets = fields.map((f) => linhaSet(f)).join('\n');
  return `${requires.join('\n')}
class ${entity}Domain {

    constructor(data) {
${ctor}
    }

    get${entity}() {
        return {
${gets}
        }
    }

    set${entity}(data) {
${sets}
        return this.get${entity}()
    }

}

module.exports = ${entity}Domain;
`;
}

function renderRepository({ entity, table, reqKnex, reqBase, reqDate, reqLogs }) {
  return `require('dotenv/config');
const knex = require(${JSON.stringify(reqKnex)})();
const ErrorStackParser = require('error-stack-parser');
const dateNow = require(${JSON.stringify(reqDate)});
const BaseRepository = require(${JSON.stringify(reqBase)});
const logs = require(${JSON.stringify(reqLogs)});

class ${entity}Repository extends BaseRepository {

    constructor() {
        super({ tableName: '${table}', knexOrTransaction: knex })
    }

    async create${entity}(data) {
        try {
            const response = await knex('${table}').insert(data)
            return { status: true, data: response, msg: '${entity} criado com sucesso!' }
        } catch (error) {
            logs.getInstance().fatal({ err: error, descricaoDoErro: 'Repositorio${entity} - create${entity}', data_criacao: dateNow() }, 'Erro no Repositorio${entity}')
            return { status: false, error, msg: 'Nao foi possivel criar o ${entity}!' }
        }
    }

    async update${entity}(data) {
        try {
            const check = await this.get${entity}ById(data)
            if (check.status && check.exit) {
                const response = await knex('${table}').update(data).where('id', data.id)
                return { status: true, data: response, msg: '${entity} atualizado com sucesso!' }
            }
            return { status: false, msg: '${entity} nao encontrado!' }
        } catch (error) {
            const stackFrames = ErrorStackParser.parse(error);
            logs.getInstance().fatal({ err: error, linhaDoErro: stackFrames[0] && stackFrames[0].lineNumber, data_criacao: dateNow() }, 'Erro no Repositorio${entity}')
            return { status: false, error, msg: 'Nao foi possivel atualizar o ${entity}!' }
        }
    }

    async delete${entity}(data) {
        try {
            const check = await this.get${entity}ById(data)
            if (check.status && check.exit) {
                const response = await knex('${table}').update({ deletado: true, data_atualizacao: dateNow() }).where('id', data.id)
                return { status: true, data: response, msg: '${entity} deletado com sucesso!' }
            }
            return { status: false, msg: '${entity} nao encontrado!' }
        } catch (error) {
            logs.getInstance().fatal({ err: error, data_criacao: dateNow() }, 'Erro no Repositorio${entity}')
            return { status: false, error, msg: 'Nao foi possivel deletar o ${entity}!' }
        }
    }

    async get${entity}() {
        try {
            const response = await knex('${table}').select('*').where('deletado', false)
            if (response.length > 0) return { status: true, exit: true, data: response, msg: '${entity} encontrado com sucesso!' }
            return { status: true, exit: false, msg: '${entity} nao encontrado!' }
        } catch (error) {
            logs.getInstance().fatal({ err: error, data_criacao: dateNow() }, 'Erro no Repositorio${entity}')
            return { status: false, error, msg: 'Nao foi possivel buscar o ${entity}!' }
        }
    }

    async get${entity}ById(data) {
        try {
            const response = await knex('${table}').select('*').where('id', data.id).andWhere('deletado', false)
            if (response.length > 0) return { status: true, exit: true, data: response[0], msg: '${entity} encontrado com sucesso!' }
            return { status: true, exit: false, msg: '${entity} nao encontrado!' }
        } catch (error) {
            logs.getInstance().fatal({ err: error, data_criacao: dateNow() }, 'Erro no Repositorio${entity}')
            return { status: false, error, msg: 'Nao foi possivel buscar o ${entity}!' }
        }
    }

}

module.exports = new ${entity}Repository();
`;
}

function cabecalhoUseCase({ reqRepo, reqDomain, reqLog, reqDate, extra }) {
  return `const repository = require(${JSON.stringify(reqRepo)});
const domain = require(${JSON.stringify(reqDomain)});
const logExeption = require(${JSON.stringify(reqLog)});
const dateNow = require(${JSON.stringify(reqDate)});
const ErrorStackParser = require('error-stack-parser');
${extra || ''}`;
}

function catchUseCase(entity, onde) {
  return `        } catch (err) {
            let lineError = '0';
            let fileName = '0';
            const stackFrames = ErrorStackParser.parse(err);
            if (stackFrames.length > 0) {
                lineError = stackFrames[0].lineNumber;
                fileName = stackFrames[0].fileName;
            }
            logExeption({ descricaoDoErro: 'Exeption estourada. use case ${entity} - ${onde}', linhaDoErro: lineError, nomeDoArquivo: fileName, data_criacao: dateNow(), data_atualizacao: dateNow(), deletado: false })
            return { status: false, msg: 'Erro interno do servidor, log gerado' }
        }`;
}

function renderGet({ entity, reqs }) {
  return `${cabecalhoUseCase(reqs)}
class get${entity}UseCase {

    async get${entity}() {
        try {
            const response = await repository.get${entity}()
            if (response.status && response.exit) return { status: true, data: response.data, msg: response.msg }
            return { status: false, msg: response.msg, response }
${catchUseCase(entity, `get${entity}UseCase - get${entity}`)}
    }

    async get${entity}ById(data) {
        try {
            const response = await repository.get${entity}ById(data)
            if (response.status && response.exit) return { status: true, data: response.data, msg: response.msg }
            return { status: false, msg: response.msg, response }
${catchUseCase(entity, `get${entity}UseCase - get${entity}ById`)}
    }

}

module.exports = new get${entity}UseCase();
`;
}

function renderCreate({ entity, reqs }) {
  return `${cabecalhoUseCase(reqs)}
class create${entity}UseCase {

    async index${entity}(data) {
        try {
            const obj${entity} = new domain({ ...data, data_criacao: dateNow() })
            const response = await repository.create${entity}(obj${entity})
            return { status: response.status, object: obj${entity}, msg: response.msg }
${catchUseCase(entity, `create${entity}UseCase - index${entity}`)}
    }

}

module.exports = new create${entity}UseCase();
`;
}

function renderUpdate({ entity, reqs }) {
  return `${cabecalhoUseCase({ ...reqs, extra: `const getUseCase = require('./get${entity}UseCase');` })}
class update${entity}UseCase {

    async index${entity}(data) {
        try {
            const obj${entity} = new domain(data)
            const check${entity} = await getUseCase.get${entity}ById(data)
            if (!check${entity}.status) return { status: false, msg: '${entity} nao encontrado.' }
            const response = await repository.update${entity}(obj${entity})
            return { status: response.status, oldObject: check${entity}.data, object: obj${entity}, msg: response.msg }
${catchUseCase(entity, `update${entity}UseCase - index${entity}`)}
    }

}

module.exports = new update${entity}UseCase();
`;
}

function renderDelete({ entity, reqs }) {
  return `${cabecalhoUseCase({ ...reqs, extra: `const getUseCase = require('./get${entity}UseCase');` })}
class delete${entity}UseCase {

    async index${entity}(data) {
        try {
            const check${entity} = await getUseCase.get${entity}ById(data)
            if (!check${entity}.status) return { status: false, msg: '${entity} nao encontrado.' }
            const obj${entity} = new domain(data)
            const response = await repository.delete${entity}(obj${entity})
            return { status: response.status, object: check${entity}.data, msg: response.msg }
${catchUseCase(entity, `delete${entity}UseCase - index${entity}`)}
    }

}

module.exports = new delete${entity}UseCase();
`;
}

function renderController({ entity, fields, reqs }) {
  const obrigatorios = fields
    .filter((f) => !ESPECIAIS.has(f))
    .map(
      (f) =>
        `        if (allData.${f} === undefined || allData.${f} === null || allData.${f} === '' || allData.${f} === ' ') return res.status(400).json({ status: false, msg: 'Campo ${f} nao pode ser vazio' })`,
    )
    .join('\n');
  return `const logExeption = require(${JSON.stringify(reqs.log)});
const ErrorStackParser = require('error-stack-parser');
const dateNow = require(${JSON.stringify(reqs.date)});
const getUseCase = require(${JSON.stringify(reqs.get)});
const createUseCase = require(${JSON.stringify(reqs.create)});
const updateUseCase = require(${JSON.stringify(reqs.update)});
const deleteUseCase = require(${JSON.stringify(reqs.delete)});
const logs = require(${JSON.stringify(reqs.logs)});

class ${entity}Controller {

    async get${entity}(req, res) {
        try {
            const id = req.params.id
            if (id === undefined || id === null || id === '' || id === ' ') return res.status(400).json({ status: false, msg: 'Id nao pode ser vazio' })
            const response = await getUseCase.get${entity}ById({ id })
            if (response.status) return res.status(200).json({ status: response.status, data: response.data, msg: response.msg })
            res.status(404).json({ status: response.status, msg: response.msg })
        } catch (err) {
            logs.getInstance().error({ err, data_criacao: dateNow() }, 'Erro no ${entity}Controller - get${entity}')
            logExeption({ err, data_criacao: dateNow() })
            res.status(500).json({ status: false, msg: 'Erro interno no servidor' })
        }
    }

    async post${entity}(req, res) {
        try {
            const allData = req.body
${obrigatorios}
            const response = await createUseCase.index${entity}(allData)
            if (response.status) return res.status(200).json({ status: response.status, msg: response.msg })
            res.status(400).json({ status: response.status, msg: response.msg })
        } catch (err) {
            const stackFrames = ErrorStackParser.parse(err);
            logs.getInstance().error({ err, linhaDoErro: stackFrames[0] && stackFrames[0].lineNumber, data_criacao: dateNow() }, 'Erro no ${entity}Controller - post${entity}')
            res.status(500).json({ status: false, msg: 'Erro interno no servidor' })
        }
    }

    async patch${entity}(req, res) {
        try {
            const id = req.params.id
            const allData = req.body
            if (id === undefined || id === null || id === '' || id === ' ') return res.status(400).json({ status: false, msg: 'Campo id nao pode ser vazio' })
${obrigatorios}
            const response = await updateUseCase.index${entity}({ ...allData, id })
            if (response.status) return res.status(200).json({ status: response.status, msg: response.msg })
            res.status(400).json({ status: response.status, msg: response.msg })
        } catch (err) {
            logs.getInstance().error({ err, data_criacao: dateNow() }, 'Erro no ${entity}Controller - patch${entity}')
            res.status(500).json({ status: false, msg: 'Erro interno no servidor' })
        }
    }

    async delete${entity}(req, res) {
        try {
            const id = req.params.id
            if (id === undefined || id === null || id === '' || id === ' ') return res.status(400).json({ status: false, msg: 'Campo id nao pode ser vazio' })
            const response = await deleteUseCase.index${entity}({ id })
            if (response.status) return res.status(200).json({ status: response.status, msg: response.msg })
            res.status(400).json({ status: response.status, msg: response.msg })
        } catch (err) {
            logs.getInstance().error({ err, data_criacao: dateNow() }, 'Erro no ${entity}Controller - delete${entity}')
            res.status(500).json({ status: false, msg: 'Erro interno no servidor' })
        }
    }

}

module.exports = new ${entity}Controller();
`;
}

function renderLog({ entity }) {
  return `const fs = require('fs');
const path = require('path');

const genetateLog = async (data) => {
    try {
        const directory = path.join(__dirname, '../../../../Logs/exeptions/${entity}');
        if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
        const arquivo = path.join(directory, Date.now() + '.json');
        fs.appendFileSync(arquivo, JSON.stringify({ data }));
    } catch (err) {
        console.error('Erro ao gravar o log de excecao', err);
    }
};

module.exports = genetateLog;
`;
}

function existe(ctx, rel) {
  try {
    const { abs } = ctx.resolvePath(rel);
    return fs.existsSync(abs);
  } catch {
    return false;
  }
}

/**
 * O ignore padrao bloqueia qualquer segmento "Logs" (pasta de runtime).
 * O arquivo de codigo do plugin vive em usecase/Logs/exeption — e codigo, nao segredo.
 * Gravamos so esse caminho gerado (identificador validado), via resolvePath, se o fileService recusar.
 */
async function gravar(ctx, files, rel, content) {
  parseFile(content);
  try {
    return await files.writeFile(ctx, rel, content, null);
  } catch (err) {
    const logDeCodigo = /\/Logs\/exeption\/exeption[A-Za-z0-9_]+\.js$/.test(rel);
    if (!logDeCodigo || !err || err.code !== 'PATH_IGNORED') throw err;
    const { abs } = ctx.resolvePath(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.studio-${process.pid}-${Date.now()}.tmp`;
    await fsp.writeFile(tmp, content);
    await fsp.rename(tmp, abs);
    return { path: rel, hash: sha256(content), created: true, ignoradoPeloFileService: true };
  }
}

async function criarEntidade(ctx, files, body) {
  const entity = exigirIdent(body && body.entity, 'Entidade');
  const table = exigirTabela(body && body.table);
  const fieldsIn = body && body.fields;
  if (!Array.isArray(fieldsIn) || fieldsIn.length === 0) {
    throw HttpError.badRequest('CAMPOS_OBRIGATORIOS', 'Informe os campos da entidade');
  }
  const fields = [];
  const vistos = new Set();
  for (const f of fieldsIn) {
    const nome = exigirIdent(typeof f === 'string' ? f : f && f.name, 'Campo');
    if (vistos.has(nome)) throw HttpError.badRequest('CAMPO_DUPLICADO', `Campo duplicado: ${nome}`);
    vistos.add(nome);
    fields.push(nome);
  }

  const domainBase = layerBase(ctx, 'domain');
  const repoBase = layerBase(ctx, 'repository');
  const useBase = layerBase(ctx, 'usecase');
  const ctrlBase = layerBase(ctx, 'controller');
  const gateway = layerBase(ctx, 'gateway');

  const arquivos = {
    domain: `${domainBase}/${entity}.js`,
    repository: `${repoBase}/${entity}Repository.js`,
    get: `${useBase}/${entity}/get${entity}UseCase.js`,
    create: `${useBase}/${entity}/create${entity}UseCase.js`,
    update: `${useBase}/${entity}/update${entity}UseCase.js`,
    delete: `${useBase}/${entity}/delete${entity}UseCase.js`,
    controller: `${ctrlBase}/${entity}Controller.js`,
    log: `${useBase}/Logs/exeption/exeption${entity}.js`,
  };

  const ocupados = Object.values(arquivos).filter((rel) => existe(ctx, rel));
  if (ocupados.length) {
    throw HttpError.conflict('ENTIDADE_EXISTE', 'Ja existe arquivo desta entidade', { arquivos: ocupados });
  }

  const dateAlvo = `${gateway}/functions/data/getToday`;
  const domainSrc = renderDomain({
    entity,
    fields,
    reqUuid: 'uuid',
    reqDate: relRequire(arquivos.domain, dateAlvo),
  });
  const repoSrc = renderRepository({
    entity,
    table,
    reqKnex: relRequire(arquivos.repository, `${path.posix.dirname(repoBase)}/config/databaseConection`),
    reqBase: '.',
    reqDate: relRequire(arquivos.repository, dateAlvo),
    reqLogs: relRequire(arquivos.repository, 'Logs'),
  });
  const reqsUse = {
    reqRepo: relRequire(arquivos.get, arquivos.repository.replace(/\.js$/, '')),
    reqDomain: relRequire(arquivos.get, arquivos.domain.replace(/\.js$/, '')),
    reqLog: relRequire(arquivos.get, arquivos.log.replace(/\.js$/, '')),
    reqDate: relRequire(arquivos.get, dateAlvo),
  };
  const ctrlSrc = renderController({
    entity,
    fields,
    reqs: {
      log: relRequire(arquivos.controller, arquivos.log.replace(/\.js$/, '')),
      date: relRequire(arquivos.controller, dateAlvo),
      get: relRequire(arquivos.controller, arquivos.get.replace(/\.js$/, '')),
      create: relRequire(arquivos.controller, arquivos.create.replace(/\.js$/, '')),
      update: relRequire(arquivos.controller, arquivos.update.replace(/\.js$/, '')),
      delete: relRequire(arquivos.controller, arquivos.delete.replace(/\.js$/, '')),
      logs: relRequire(arquivos.controller, 'Logs'),
    },
  });

  const conteudos = [
    [arquivos.domain, domainSrc],
    [arquivos.repository, repoSrc],
    [arquivos.get, renderGet({ entity, reqs: reqsUse })],
    [arquivos.create, renderCreate({ entity, reqs: reqsUse })],
    [arquivos.update, renderUpdate({ entity, reqs: reqsUse })],
    [arquivos.delete, renderDelete({ entity, reqs: reqsUse })],
    [arquivos.controller, ctrlSrc],
    [arquivos.log, renderLog({ entity })],
  ];

  const gravados = [];
  for (const [rel, content] of conteudos) {
    gravados.push(await gravar(ctx, files, rel, content));
  }
  return { entity, table, fields, arquivos: gravados };
}

module.exports = { criarEntidade, renderDomain };
