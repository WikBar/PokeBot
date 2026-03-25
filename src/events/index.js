async function CheckIfGoodEvent(page){
    
try{
    const Element = await page.waitForSelector('div.alert.alert-success.text-center', { timeout: 1500 });
    const alertText = await page.evaluate(element => element.textContent, Element);
    if (alertText.includes("krzak Jagód")){
        console.log("✅ Znalazłeś krzak Jagód");
    }else if(alertText.includes("Samotne Drzewo")){
        console.log("✅ Samotne drzewo zostało znalezione");
    }else if(alertText.includes("Zwycięstwo!")){
        console.log("✅ Udało się wygrać z pokemonem!")
    }else if(alertText.includes("Udało Ci się")){
        console.log("✅ Złapałeś pokemona")
    }else if(alertText.includes("Wygrywasz walkę!")){
        console.log("✅ Pokonałeś stado")
    }else{
        console.log(alertText.trim())
        console.log("Brak pozytywnych wydarzeń")
    }
    

    return  alertText.includes("Samotne Drzewo")? 1:alertText.includes("krzak Jagód")?2:
    alertText.includes("Zwycięstwo!")?3:alertText.includes("Udało Ci się")?4:0;
}catch(e)
    {console.log("Brak pozytywnych eventów")}
    
}

async function CheckIfBadEvent(page){
    try{
    const Element = await page.waitForSelector('div.alert.alert-danger.text-center', { timeout: 1500 });
    const alertText = await page.evaluate(element => element.textContent, Element);
    
    if (alertText.includes("Przegrana z")){
        console.log("❌ Przegrałeś z pokemonem");
    }else if(alertText.includes("jednak udało mu się uwolnić i uciekł")){
        console.log("❌ Pokemon uciekł");
    }else if(alertText.includes("ładunków Apteczki")){
        console.log("❌ Tracisz punkty Apteczki");
    }else{
        console.log(alertText.trim())
        }
    
    

    return alertText.includes("Przegrana z")? 1:
    alertText.includes("jednak udało mu się uwolnić i uciekł")?2:
    alertText.includes("ładunków Apteczki")?3:0;
    
}catch(e)
    {console.log("Brak negatynwych eventów")}
}

async function CheckActivity(page){
    try{
        const InfoPanels = await page.$$(`div.alert.alert-info.text-center`);
            for (const panel of InfoPanels) {
    
        const alertText = await page.evaluate(element => element.textContent, panel);
        if (alertText.includes("Jesteś w trakcie")){
            console.log("Jesteś w trakcie aktywności");
            return true
        }else{
            console.log(alertText);
            continue;
        }
        }
        return false
    
}catch(e)
    {console.log("Błąd wykrywania aktywności")}
}


module.exports={
    CheckActivity,
    CheckIfBadEvent,
    CheckIfGoodEvent
}