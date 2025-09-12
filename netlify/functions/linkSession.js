'use strict';

// Alias dell’endpoint principale: usa esattamente la stessa logica
// di create-checkout-session, così il campo "Contesto" non riappare.

const create = require('./create-checkout-session.js');

exports.handler = create.handler;
