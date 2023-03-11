const fs = require('fs');

const { promisify } = require('util');
const path = require('path');

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)

const getFileData = async (pid) => {
  const filePath = path.join(__dirname, `./data/${pid}/config.json`)
  const data = await readFile(filePath, 'utf-8')
  return JSON.parse(data);
}

const setFileData = async (loc, data) => {
  const filePath = path.join(__dirname, `./comparer/${loc}.out`)
  await writeFile(filePath, data);
}

const getTestCase = async (pid, name) => {
  const filePath = path.join(__dirname, `./data/${pid}/${name}`)
  const data = await readFile(filePath, 'utf-8')
  return data;
}

module.exports = {
  getFileData,
  setFileData,
  getTestCase
}