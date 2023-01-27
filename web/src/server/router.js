let express = require('express');
let router = express.Router();

let info = require('./api/list');

router.get('/rabbit/all', info.all);
// router.get('/rabbit/get', info.get);
router.get('/rabbit/add', info.add);
// router.get('/rabbit/update', info.update);
// router.get('/rabbit/del', info.del);

module.exports = router;
