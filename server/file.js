const fs = require('fs');

const { promisify } = require('util');
const path = require('path');

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)

const getFile = async (loc) => {
  const filePath = path.join(__dirname, loc)
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = await readFile(filePath, 'utf-8')
  return data;
}

const setFile = async (loc, data) => {
  const filePath = path.join(__dirname, loc)
  await writeFile(filePath, data);
}

const delFile = async (loc) => {
  const filePath = path.join(__dirname, loc)
  await fs.unlinkSync(filePath);
}

module.exports = {
  getFile,
  setFile,
  delFile
}