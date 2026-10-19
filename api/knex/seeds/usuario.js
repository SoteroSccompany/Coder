/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */

exports.seed = async function (knex) {
  const { systemUser, roles } = require('../../certs')
  const moment = require('moment')
  const uuid = require('uuid')
  require('dotenv/config')
  const trx = await knex.transaction()
  try {
    await knex('tab_usuarios').del()
    await knex('tab_usuarios').insert([
      { id: systemUser.id, email: systemUser.email, must_change_password: 0, role: systemUser.role, recuperacao: null, dois_fatores: false, email_verificado: false, bloqueado: true, senha: "NoPassword", data_criacao: moment().format('YYYY-MM-DD HH:mm:ss'), data_atualizacao: moment().format('YYYY-MM-DD HH:mm:ss'), deletado: false },
      { id: uuid.v4(), email: "gabriel@netexperts.com.br", must_change_password: 0, role: roles.admin, dois_fatores: false, recuperacao: null, email_verificado: true, bloqueado: false, senha: "$2b$10$HUD8JP72LZ4.d33nyk711.5AGxF38iMufeStOfPXqHUWwl96gP.MC", data_criacao: moment().format('YYYY-MM-DD HH:mm:ss'), data_atualizacao: moment().format('YYYY-MM-DD HH:mm:ss'), deletado: false },
      { id: uuid.v4(), email: "davi@netexperts.com.br", must_change_password: 0, role: roles.admin, dois_fatores: false, email_verificado: true, recuperacao: null, bloqueado: false, senha: "$2b$10$HUD8JP72LZ4.d33nyk711.5AGxF38iMufeStOfPXqHUWwl96gP.MC", data_criacao: moment().format('YYYY-MM-DD HH:mm:ss'), data_atualizacao: moment().format('YYYY-MM-DD HH:mm:ss'), deletado: false }
    ]);
  } catch (error) {
    await trx.rollback()
    throw error
  }
};
