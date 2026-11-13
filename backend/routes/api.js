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
  router.get('/offline/status', controller.getOfflineStatus);
  router.post('/offline/allowance', controller.openOfflineAllowance);
  router.post('/offline/sync', controller.syncOffline);
  return router;
}

module.exports = { createRouter };
