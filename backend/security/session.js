const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function createSessions(config) {
  function issue() {
    const jti = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign({ role: 'terminal', jti }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
      issuer: 'minitap-sim',
      audience: 'minitap-terminal',
      subject: 'till',
    });
    const decoded = jwt.decode(token);
    return {
      token,
      expiresIn: Math.max(0, decoded.exp - decoded.iat),
      tokenType: 'Bearer',
    };
  }

  function fromRequest(req) {
    const header = req.headers.authorization || '';
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
    if (!match) return null;
    try {
      const payload = jwt.verify(match[1], config.jwtSecret, {
        issuer: 'minitap-sim',
        audience: 'minitap-terminal',
      });
      if (payload.role !== 'terminal' || !payload.jti) return null;
      return { jti: payload.jti, exp: payload.exp };
    } catch {
      return null;
    }
  }

  return { issue, fromRequest };
}

module.exports = { createSessions };
