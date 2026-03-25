require('dotenv').config(); // Wczytujemy login i hasło z pliku .env
const { chromium } = require('playwright'); // Importujemy przeglądarkę
const { CheckPA, ClickAdventure, CheckIfPokemon,
   CatchPokemon,ClickPokemon,
   CancelActivity, StartActivity,
   CheckHP,
   ClickHospital,
   SellPokemon}  = require('./actions');
const { loadFromFile } = require('./utils/fileOperations');
const { CheckIfGoodEvent,CheckIfBadEvent, CheckActivity}=require('./events');
const fs =require('fs');
const path = require('path');

// Constants
const HP_THRESHOLD = 15;
const ADVENTURE_TIMEOUT = 3000;
const REGEN_WAIT_MINUTES = 12;
const REGEN_ITERATIONS = 10;


(async () => {
  const locationsPath = path.resolve(__dirname, '..', 'config', 'locations.json');
  const configPath = path.resolve(__dirname, '..', 'config', 'config.json');
  const locations = await loadFromFile(locationsPath);


    console.log("🔧 Uruchamiam skrypt... Login: Główne konto");

  
  // 1. Startujemy przeglądarkę
  const browser = await chromium.launch({ headless: true }); // headless: false = pokazuje okno przeglądarki
  const context = await browser.newContext(); // Tworzymy nowy kontekst (czyli „nowy profil”)
  const page = await context.newPage(); // Otwieramy nową kartę

  // 2. Przechodzimy na stronę główną Pokelife
  await page.goto('https://gra.pokelife.pl/index.php');

  // 3. Wypełniamy login i hasło
  await page.fill('input[name="login"]',"WiciuBar");
  await page.fill('input[name="haslo"]', "Jajko123er");

  // 4. Klikamy przycisk "Zaloguj" i czekamy aż strona się załaduje
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForLoadState('networkidle'),
  ]);

 const isLoggedIn = await page.locator('button#wyloguj').count();
  if (isLoggedIn > 0) {
    console.log('✅ Zalogowano pomyślnie!');
  } else {
    console.log('❌ Logowanie nieudane. Sprawdź dane logowania.');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }


while (isLoggedIn){
  try {
  const accountConfig= await loadFromFile(configPath);
  if (process.env.POKE_ADVENTURE_NR) {
    const parsedAdventureNr = parseInt(process.env.POKE_ADVENTURE_NR, 10);
    if (!Number.isNaN(parsedAdventureNr)) {
      accountConfig.adventureNr = parsedAdventureNr;
    } else {
      console.log("⚠️ Niepoprawna wartość POKE_ADVENTURE_NR, używam wartości z config.json");
    }
  }
  console.log(`🔧 Konfiguracja załadowana dla konta: ${accountConfig.region},${accountConfig.pokemonIndex},${accountConfig.adventureNr}`);
  const region=locations[accountConfig.region];
  await SellPokemon(page, accountConfig.sellablePokemon);
  
  if( (await CheckPA(page)).currentPA>region[accountConfig.adventureNr].requiredPA ){
    if (await CheckActivity(page)){
      await CancelActivity(page);
    }

  while ((await CheckPA(page)).currentPA>=region[accountConfig.adventureNr].requiredPA){
    console.log("Wystarczająća ilość PA")

    if ((await CheckHP(page)).currentHP < HP_THRESHOLD){
      console.log("🔴 Niskie HP, idę do Centrum Pokemon");
      await ClickHospital(page);
    }
    
    await ClickAdventure(page,accountConfig,locations);

    await CheckIfGoodEvent(page)
    await CheckIfBadEvent(page)
    const pokemonInfo= await CheckIfPokemon(page);
      if (pokemonInfo.isPokemon){
        if (pokemonInfo.level>45){
            await ClickPokemon(page,accountConfig.pokemonIndex);
        }else{
          await ClickPokemon(page,0);
        }

        if (await CheckIfGoodEvent(page)==3){
          await CatchPokemon(page,pokemonInfo,region[accountConfig.adventureNr]);
          }

      }else{
        console.log("Brak Pokemona na przygodzie")
      }
      await page.waitForTimeout(ADVENTURE_TIMEOUT);
    }
    }
    if (await CheckActivity(page)==false && (await CheckPA(page)).currentPA<region[accountConfig.adventureNr].requiredPA){
      await StartActivity(page);
    }
    await page.reload();
    console.log("Czekam na odnowienie punktów akcji")
    console.log(new Date().getHours());

    for (let i = 0; i < REGEN_ITERATIONS; i++){
        await page.waitForTimeout(REGEN_WAIT_MINUTES * 60 * 1000);
        await page.reload();
        console.log(new Date().toLocaleTimeString());
        console.log("Pozostało "+ (REGEN_ITERATIONS - 1 - i) * REGEN_WAIT_MINUTES +" minut")
    }

    if (new Date().getHours()==0 && new Date().getMinutes()<30){
      console.log("Trwa przerwa na serwerze czekamy 30 minut")
      await page.waitForTimeout(30*60*1000);
    }
  } catch (error) {
    console.error("Error in main loop:", error);
    await page.waitForTimeout(5000); // Wait before retrying
  }
}

})();

// 6. (Opcjonalnie) robimy zrzut ekranu po zalogowaniu
  
// 7. Zamykamy przeglądarkę po kilku sekundach (dla testów)
  

