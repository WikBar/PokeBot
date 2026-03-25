async function CheckHP(page) {
  const hpText = await page.$$('div.well.well-stan');
  const elementHP = await hpText[4].innerText();
  const currentStr = await elementHP.replace('%', '');
  const currentHP = parseFloat(currentStr, 10);
  const maxHP = 100;
  console.log(`❤️ HP: ${currentHP}% /${maxHP}% `);
  return { currentHP: currentHP, maxHP: maxHP };
}

async function ClickHospital(page) {
  await page.getByRole('img', { name: 'Przejdź do Centrum Pokemon' }).click();
  console.log("🏥 Udano się do Centrum Pokemon");
  await page.locator('button', { hasText: 'Uzupełnij za' }).click();
  console.log("❤️ HP zostało uzupełnione do 100%");
}

async function EatRawstBerry(page) {
  await page.getByRole('img', { name: 'Zjedz Jagody Rawst' }).click();
  console.log("🏥 Użyto Jagód Rawst");
}

module.exports = {
  CheckHP,
  ClickHospital,
  EatRawstBerry
};
