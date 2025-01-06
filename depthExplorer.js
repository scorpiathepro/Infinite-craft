const fs = require("fs");
const readline = require('readline');


const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());


// Settings
const combineTime = 300;    // ms
const combineRetries = 3;   // Maximum retries for a failed combination
const stopAfterDepth = 4;
const parallelBots = 10;    // Number of concurrent workers (probably dont modify this)
const batchLogs = 0;      // set to 0 to disable element logs


const baseElements = ["Plant", "Tree", "River", "Delta", "Paper", "Book", "Alphabet", "Word", "Sentence", "Phrase", "Quote", "Punctuation"].map(icCase);
         // gen 5 done ["Plant", "Tree", "Ash", "Pencil", "Paper", "Book", "Homework", "Coffee", "A", "Alphabet", "Study", "Grammar", "Punctuation", "Ampersand", "@"]
         // gen 6 done ["Plant", "Tree", "River", "Delta", "Paper", "Book", "Alphabet", "Word", "Sentence", "Phrase", "Quote", "Punctuation"]
                    // ["Plant", "Tree", "River", "Delta", "Paper", "Book", "Alphabet", "Word", "Sentence", "Phrase", "Quote", "Punctuation", "Apostrophe", "Period", "Full Stop", "End", "Dust", "Clean", "Begin", "'"]
                    // ["Smoke", "Dust", "Planet", "Sun", "Sunflower", "Smoke Signal", "Message", "Letter", "A"]
                    // ["Plant", "Tree", "Ash", "Pencil", "Paper", "Book", "Homework", "Coffee", "A"]
                    // ["Smoke", "Cloud", "Lightning", "Sun", "Sunflower", "Smoke Signal", "Message", "Letter", "A"]

const baseBaseElements = ["Fire", "Water", "Earth", "Wind"];
const fullBaseSet = new Set([...baseBaseElements, ...baseElements]);
const endElements = new Set(["Hashtag", "Punctuation", "Grammar", "Grammar", "Sentence", "Quote", "Phrase", "Period", "Comma", "Colon", "Semicolon", "Parenthesis", "Parentheses", "Slash", "Alphabetical", "Ampersand", "Abrreviation", "Not", "Quotation",
                             "Hyphen", "Dash", "Addition", "Minus", "Plus", "Power", "Plural", "Cross", "Palindrome", "42", "Question", "Answer", "Universe"]);




const depthLists = [ /* Depth */ new Set(["" /* Seed (starts empty) */ ])];
const encounteredElements = new Map(); // { element: seeds }

const recipesIng = loadRecipes();
const recipesRes = new Map();

const precomputedRecipesRes = new Map();  // optimization for printing all Lineages

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastCombination = Date.now();



let processedSeeds = 0;
let totalSeeds = 0;
let depth = 0;
let startTime = Date.now();
let lastBatchLog = [];


(async () => {
    const browser = await puppeteer.launch({ headless: true }); // false for debugging
    const page = await browser.newPage();

    await page.goto("https://neal.fun/infinite-craft", { waitUntil: "domcontentloaded" });
    console.log("Page loaded successfully!");
    console.log("For help with commands type 'help'");



    (async function main() {
        function printSeedProgress() {
            console.log('Depth', depth+1, '-', processedSeeds, "/", totalSeeds, "seeds processed -", Math.round(processedSeeds / totalSeeds * 100 * 100) / 100, "%"
            );
        }
        const interval = setInterval(() => {
            printSeedProgress();
        }, 10 * 1000);  // 10 seconds

        // calculate depth1 ONCE  (set)
        const depth1 = await processCombinations(allCombinations([...fullBaseSet]));

        while (true) {
            depthLists[depth + 1] = new Set();
            processedSeeds = 0;
            totalSeeds = depthLists[depth].size;


            async function worker(seedGen) {
                for (let seed of seedGen) {
                    seed = seed === '' ? [] : seed.split('=');

                    const combElements = [...seed.map(x => icCase(x)), ...fullBaseSet];

                    let allResults = new Set(depth1);    // use prebcalculated depth1
                    // do all non base-base combinations as those are already in depth1
                    for (let i = 0; i < seed.length; i++) {
                        for (let j = i; j < combElements.length; j++) {
                            const combination = [combElements[i], combElements[j]].sort();
                            const combString = combination.join('=');
                            let recExists = recipesIng[combString];

                            if (recExists) {
                                if (!recipesRes.has(recExists)) recipesRes.set(recExists, new Set());
                                recipesRes.get(recExists).add(combString);
                            }
                            else recExists = await combine(...combination);

                            if (recExists !== "Nothing") allResults.add(recExists);
                        }
                    }


                    for (const result of allResults) {
                        if (seed.includes(result) || fullBaseSet.has(result)) continue;

                        if (encounteredElements.has(result)) {
                            const a = encounteredElements.get(result)
                            if (a[0].length - 1 === depth) {
                                a.push([...seed, result].sort());
                            }
                        }
                        else {
                            encounteredElements.set(result, [[...seed, result].sort()]);
                            if (batchLogs !== 0) lastBatchLog.push(result);
                            if (encounteredElements.size % batchLogs === 0) {
                                printSeedProgress();

                                if (batchLogs !== 0) {
                                    console.log('\n', depth + 1, `- Last ${batchLogs} Elements made:\n` + lastBatchLog.join(',   '));
                                    lastBatchLog = [];
                                }
                            }

                            // await processCombinations(baseElements.map(item => [result, item]));
                            // processCombinations([[result, "@"]]);

                            if (endElements.has(result) || result.length === 1 || /^(\W?[a-zA-Z]\W?)$/.test(result)) {
                                console.log('\n', ...makeLineage(encounteredElements.get(result), result + " Lineage"));
                            }
                        }

                        if (depth < stopAfterDepth - 1 && result.length <= 30) {
                            const newSeed = [...seed, result];

                            let countDepth1s = 0;
                            let nonDepth1 = 0;
                            for (const res of newSeed) {
                                if (depth1.has(res)) countDepth1s++;
                                else nonDepth1++;
                            }

                            if (countDepth1s - (2 * nonDepth1) <= 2)
                                depthLists[depth + 1].add(newSeed.sort().join('='));
                        }
                    }
                    processedSeeds++;
                }
            }
            // parallize set iterator (3 fancy words)
            function* seedGenerator(set) {
                for (const item of set) {
                    yield item;
                }
            }

            const seedGen = seedGenerator(depthLists[depth]);
            const workers = Array(parallelBots).fill().map(() => worker(seedGen));
            await Promise.all(workers); // wait for all workers to finish


            console.log("\nDepth:", depth + 1, "completed!", "\nTime:", (Date.now() - startTime) / 1000, "s\nSeeds:", totalSeeds, "->", depthLists[depth + 1].size, "\nElements:", encounteredElements.size);
            if (depth > stopAfterDepth - 2) {
                clearInterval(interval);
                console.log("%cDone!", 'background: red; color: white');
                await browser.close();
                return;
            }

            depth++;
        }
    })();






    async function combine(first, second) {
        const waitingDelay = Math.max(0, combineTime - (Date.now() - lastCombination));
        lastCombination = Date.now() + waitingDelay;
        await delay(waitingDelay);

        // if recipe suddenly exists after awaiting delay
        const recExists = recipeExists(first, second);
        if (recExists) {
            lastCombination -= combineTime;
            return recExists;
        }

        for (let attempt = 0; attempt < combineRetries; attempt++) {
            const url = `/api/infinite-craft/pair?first=${encodeURIComponent(first)}&second=${encodeURIComponent(second)}`;
            let response;

            try {
                response = await page.evaluate(async (url) => {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`Failed with status: ${res.status}`);
                    return res.json();
                }, url);
            } catch (error) {
                if (attempt < combineRetries - 1) {  // if it is NOT the final attempt
                    lastCombination += combineTime;
                    continue;
                }
            }

            const result = response?.result || "Nothing";
            const combString = `${first}=${second}`;
            recipesIng[combString] = result;

            if (!recipesRes.has(result)) recipesRes.set(result, new Set());
            recipesRes.get(result).add(combString);

            console.log(`Combine: ${first} + ${second} = ${result}`);
            return result;
        }
    }



    function allCombinations(array) {
        const combinations = [];
        for (let i = 0; i < array.length; i++) {
            for (let j = 0; j <= i; j++) {
                combinations.push([array[i], array[j]].sort());
            }
        }
        return combinations;
    }




    async function processCombinations(combinations) {
        const results = new Set();
        combinations = combinations.map(([first, second]) => [icCase(first), icCase(second)].sort());

        for (const [first, second] of combinations) {
            let result = recipeExists(first, second);
            if (!result) {
                result = await combine(first, second);
            }
            if (result && result !== "Nothing") {
                results.add(result);
            }
        }

        return results;
    }
})();























function saveRecipes(recipes) {
    fs.writeFileSync("recipes.json", JSON.stringify(recipesIng, null, 4), "utf8");
    console.log("Recipes saved to recipes.json");
}
function loadRecipes() {
    if (fs.existsSync("recipes.json")) {
        const data = fs.readFileSync("recipes.json", "utf8");
        return JSON.parse(data);
    } else {
        console.error("No recipes.json file found. Please make one.");
    }
}
setInterval(() => saveRecipes(recipesIng), 5 * 60 * 1000);


function recipeExists(first, second) {
    // first and second have to already be icCased and sorted!
    // [first, second] = [icCase(first), icCase(second)].sort();
    const combString = `${first}=${second}`;
    const result = recipesIng[combString];

    if (result) {
        if (!recipesRes.has(result)) recipesRes.set(result, new Set());
        recipesRes.get(result).add(combString);

        return result;
    }
}


function makeLineage(lineages, element) {
    // generate a valid lineage using just the results
    return [ lineages[0].length, `- ${element}:`,
        lineages.map(lineage => generateLineageFromResults(lineage).map(recipe => `\n${recipe[0]} + ${recipe[1]} = ${recipe[2]}`).join('')).join('\n ...') ];
}

function generateLineageFromResults(results, allowBaseElements=true) {
    const toUse = new Set(allowBaseElements ? fullBaseSet : baseBaseElements);
    const toAdd = new Set([...results])
    let recipe = [];

    // required to make different cases work THIS WAS A PAIN TO CODE
    const correctCaseMap = new Map();

    while (toAdd.size > 0) {
        let addedSmth = false
        for (const result of toAdd) {
            const validRecipe = (precomputedRecipesRes.get(result) || Array.from(recipesRes.get(result)).map(x => x.split('=')))
                .find(([first, second]) =>
                      toUse.has(first) &&
                      toUse.has(second) &&
                      (!correctCaseMap.has(first) || correctCaseMap.get(first) !== result) &&
                      (!correctCaseMap.has(second) || correctCaseMap.get(second) !== result));

            if (validRecipe) {
                recipe.push([...validRecipe.map(x => correctCaseMap.has(x) ? correctCaseMap.get(x) : x), result]);
                const icResult = icCase(result);
                toUse.add(icResult);
                correctCaseMap.set(icResult, result);
                toAdd.delete(result);
                addedSmth = true;
            }
        }
        if (!addedSmth) return [...recipe, ...["could", "not generate", "Lineage"]];
    }
    return recipe;
}


function icCase(input) {
    let result = '';
    const len = input.length;

    for (let i = 0; i < len; i++) {
        const char = input[i];
        result += (i === 0 || input[i - 1] === ' ') ? char.toUpperCase() : char.toLowerCase()
    }

    return result;
};










const repl = require('repl');

// Create a REPL instance
const replServer = repl.start({ prompt: '> ' });

// Define commands
replServer.context.help = () => console.log(replServer.context);
replServer.context.clearNothings = () => {
    let count = 0;
    for (const key in recipesIng) {
        if (recipesIng[key] === "Nothing") {
            delete recipesIng[key]; // Remove the entry
            count++;
        }
    }
    return `Removed ${count} recipes with 'Nothing'`;
}
replServer.context.lineage = (element) => {
    element = icCase(element);
    const message = [];
    for (const [elem, seed] of encounteredElements.entries()) {
        if (icCase(elem) === element) {
            message.push(makeLineage(seed, elem + " Lineage").join(" "));
        }
    }
    return message.length > 0 ? message.join('\n\n') : "This Element has not been made...";
}

replServer.context.lineagesFile = () => {
    let content = [];

    content.push(generateLineageFromResults(baseElements, false).map(recipe => `${recipe[0]} + ${recipe[1]} = ${recipe[2]}`).join('\n') + `  // ${baseElements.length}`);

    const genCounts = Array(depth + 1).fill(0);
    encounteredElements.forEach(seeds => genCounts[seeds[0].length - 1]++);
    let runningTotal = 0;
    content.push(genCounts.map((count, index) => {
        runningTotal += genCounts[index];
        return `Gen ${index + 1} - ${count} Elements -> ${runningTotal} Total Elements`;
    }).join('\n'));



    console.time("Generate Lineages File");
    for (const [result, recipes] of recipesRes.entries()) {
        precomputedRecipesRes.set(result, Array.from(recipes).map(x => x.split('=')));
    }

    content.push(Array.from(encounteredElements.entries())
        .map(([element, lineage]) => makeLineage(lineage, element).join(' '))
        .join('\n\n'));

    precomputedRecipesRes.clear();
    console.timeEnd("Generate Lineages File");


    content.push(JSON.stringify(Object.fromEntries(
        Array.from(encounteredElements, ([element, seed]) => [element, seed[0].length])),
        null, 2));


    const filename = `${baseElements[baseElements.length - 1]} Seed - ${Math.floor(processedSeeds / totalSeeds * 100)}p gen ${depth + 1}.txt`;
    fs.writeFileSync(`./${filename}`, content.join('\n\n\n\n'), "utf8");
    return `File saved: ${filePath}`;
};


replServer.context.currentElements = () => console.log(Array.from(encounteredElements.keys()).join('\n'));
// prints all elements that have been made in the current run and that haven't been used in any recipe
replServer.context.likelyDead = () => {
    const candidatesSet = new Set(encounteredElements.keys().filter(x => x !== icCase(x)));
    console.log(candidatesSet.size);

    const recipeResSet = new Set();
    for (const [element, recipes] of recipesRes) {
        if (element === "Nothing") continue;
        for (const recipe of recipes) {
            recipe.split('=', 2).forEach(x => recipeResSet.add(x));
        }
    }
    for (const element of candidatesSet) {
        if (recipeResSet.has(icCase(element))) candidatesSet.delete(element);
    }
    console.log(candidatesSet.size);
    console.log([...candidatesSet].join('\n'))
}


// Handle process cleanup on exit or stop
function onExit() {
    saveRecipes(recipesIng);
}

// Handle the "beforeExit" event
process.on('beforeExit', () => {
    onExit();
});

// Listen for termination signals (for Ctrl+C)
process.on('SIGINT', () => {
    onExit();
    process.exit(0); // Exit gracefully
});

// Handle process exit (e.g., from Shift+F5 in VS Code)
process.on('exit', (code) => {
    onExit();
});