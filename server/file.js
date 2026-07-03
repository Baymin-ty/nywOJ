const storage = require('./storage');

const getFile = async (loc) => {
  return storage.getText(loc, 'utf-8');
}

const setFile = async (loc, data) => {
  await storage.putText(loc, data);
}

const delFile = async (loc) => {
  await storage.deleteObject(loc);
}

module.exports = {
  getFile,
  setFile,
  delFile,
  storage,
}
