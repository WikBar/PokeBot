async function CheckPA(page) {
  const paText = await page.locator('div.progress-bar-info span').innerText();
  const [currentStr, maxStr] = paText.replace(' PA', '').split('/');
  const currentPA = parseInt(currentStr, 10);
  const maxPA = parseInt(maxStr, 10);
  console.log(`📊 PA: ${currentPA} / ${maxPA}`);
  return { currentPA: currentPA, maxPA: maxPA };
}

module.exports = {
  CheckPA
};
