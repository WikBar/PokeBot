const fs = require('fs').promises;
const { logger } = require('./logger');

const log = logger.child({ module: 'fileOperations' });

async function loadFromFile(filePath) {
  log.debug('Ładowanie pliku', { filePath });
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    log.error('Error reading the file', { filePath, error: String(err), stack: err?.stack });
    return;
  }
}

async function saveToFile(filePath, data) {
  log.debug('Zapisywanie pliku', { filePath });
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    log.error('Error saving the file', { filePath, error: String(err), stack: err?.stack });
  }
}

module.exports = { loadFromFile, saveToFile };