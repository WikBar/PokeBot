const { logger } = require('../utils/logger');

const log = logger.child({ module: 'events' });

async function CheckIfGoodEvent(page){
    
try{
    const Element = await page.waitForSelector('div.alert.alert-success.text-center', { timeout: 1200 });
    const alertText = await page.evaluate(element => element.textContent, Element);
    if (alertText.includes("krzak Jagód")){
        log.info("Znalazłeś krzak Jagód");
    }else if(alertText.includes("Samotne Drzewo")){
        log.info("Samotne drzewo zostało znalezione");
    }else if(alertText.includes("Zwycięstwo!")){
        log.info("Udało się wygrać z pokemonem!");
    }else if(alertText.includes("Udało Ci się")){
        log.info("Złapałeś pokemona");
    }else if(alertText.includes("Wygrywasz walkę!")){
        log.info("Pokonałeś stado");
    }else{
        log.info(alertText.trim());
        log.info("Brak pozytywnych wydarzeń");
    }
    

    return  alertText.includes("Samotne Drzewo")? 1:alertText.includes("krzak Jagód")?2:
    alertText.includes("Zwycięstwo!")?3:alertText.includes("Udało Ci się")?4:0;
}catch(e)
    {log.debug("Brak pozytywnych eventów")}
    
}

async function CheckIfBadEvent(page){
    try{
    const Element = await page.waitForSelector('div.alert.alert-danger.text-center', { timeout: 1200 });
    const alertText = await page.evaluate(element => element.textContent, Element);
    
    if (alertText.includes("Przegrana z")){
        log.warn("Przegrałeś z pokemonem");
    }else if(alertText.includes("jednak udało mu się uwolnić i uciekł")){
        log.warn("Pokemon uciekł");
    }else if(alertText.includes("ładunków Apteczki")){
        log.warn("Tracisz punkty Apteczki");
    }else{
        log.info(alertText.trim());
        }
    
    

    return alertText.includes("Przegrana z")? 1:
    alertText.includes("jednak udało mu się uwolnić i uciekł")?2:
    alertText.includes("ładunków Apteczki")?3:0;
    
}catch(e)
    {log.debug("Brak negatywnych eventów")}
}

async function CheckActivity(page){
    try{
        const InfoPanels = await page.$$(`div.alert.alert-info.text-center`);
            for (const panel of InfoPanels) {

        const alertText = await page.evaluate(element => element.textContent, panel);
        if (alertText.includes("Jesteś w trakcie Opieki")){
            log.info("Jesteś w trakcie Opieki");
            return 'care';
        } else if (alertText.includes("Jesteś w trakcie Pracy")){
            // Praca to zwykla aktywnosc - konczy sie tym samym "Zakoncz",
            // co trening. Rozrozniamy ja tylko w logach.
            log.info("Jesteś w trakcie Pracy");
            return true;
        } else if (alertText.includes("Jesteś w trakcie")){
            log.info("Jesteś w trakcie aktywności");
            return true;
        }else{
            log.debug(alertText);
            continue;
        }
        }
        return false

}catch(e)
    {log.warn("Błąd wykrywania aktywności", { error: String(e) })}
}


module.exports={
    CheckActivity,
    CheckIfBadEvent,
    CheckIfGoodEvent
}