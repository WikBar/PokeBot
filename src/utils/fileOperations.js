const fs = require('fs').promises;

async function loadFromFile(filePath) {
  console.log(`Ładowanie pliku: ${filePath}`);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading the file:', err);
    return;
  }
}
module.exports = { loadFromFile };