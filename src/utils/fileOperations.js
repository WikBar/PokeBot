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
  // Zapis atomowy: tmp + fsync + rename, zeby zanik pradu nie zostawil pliku z samymi zerami
  const tmpPath = `${filePath}.tmp`;
  try {
    const handle = await fs.open(tmpPath, 'w');
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    log.error('Error saving the file', { filePath, error: String(err), stack: err?.stack });
  }
}

module.exports = { loadFromFile, saveToFile };