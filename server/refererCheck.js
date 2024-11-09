const url = require('url');

/**
 * 创建一个检查referer的中间件
 * @param {Array<string>} whiteList - 允许的referer域名白名单
 * @param {Object} options - 配置选项
 * @returns {Function} Express/Node.js 中间件函数
 */
function refererCheck(whiteList = ['localhost'], options = {}) {
  // 标准化白名单URL
  const normalizedWhiteList = whiteList.map(domain => {
    // 处理localhost特殊情况
    if (domain === 'localhost') {
      return domain;
    }
    // 确保域名以https://或http://开头
    if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
      domain = 'https://' + domain;
    }
    // 确保域名以/结尾
    if (!domain.endsWith('/')) {
      domain = domain + '/';
    }
    return new URL(domain).origin;
  });

  return (req, res, next) => {
    // 获取referer
    const referer = req.headers.referer || req.headers.referrer;

    // 如果没有referer
    if (!referer) {
      if (options.allowEmpty) {
        return next();
      }
      return res.status(403).json({
        error: 'Access Denied',
        message: 'No referer provided'
      });
    }

    try {
      // 解析referer URL
      const refererUrl = new URL(referer);
      const refererOrigin = refererUrl.origin;

      // 检查是否为localhost
      if (refererUrl.hostname === 'localhost' && normalizedWhiteList.includes('localhost')) {
        return next();
      }

      // 检查是否在白名单中
      if (normalizedWhiteList.some(domain => {
        if (domain === 'localhost') return false;
        return refererOrigin === domain;
      })) {
        return next();
      }

      // 如果不在白名单中，返回403
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Invalid referer'
      });

    } catch (error) {
      // 处理无效的URL
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Invalid referer format'
      });
    }
  };
}

module.exports = refererCheck;