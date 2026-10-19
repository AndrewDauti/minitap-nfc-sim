const express = require('express');

function createRouter(controller) {
  const router = express.Router();
  router.get('/security-model', controller.getModel);
  router.post('/session', controller.handleSession);
  router.use(controller.requireSession);
  router.get('/wallets', controller.getWallets);
  router.get('/transactions', controller.getTransactions);
  router.get('/audit', controller.getAudit);
  router.post('/tap/cryptogram', controller.handleCryptogram);
  router.post('/tap', controller.handleTap);
  return router;
}

module.exports = { createRouter };
