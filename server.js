const fetch = require('node-fetch');
const http = require("http");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, 'credentials/.env') })
const bodyParser = require("body-parser");
// const fs = require("fs");
const express = require("express");
const app = express();

app.set("views", path.resolve(__dirname, "templates"));
app.set("view engine", "ejs");
app.use(express.static(__dirname));
app.use(bodyParser.urlencoded({ extended: false }));
process.stdin.setEncoding("utf8");
const portNumber = process.env.PORT || 5000;
console.log(`Visit http://localhost:${portNumber}`);

// MongoDB imports 
const username = process.env.MONGO_DB_USERNAME;
const password = process.env.MONGO_DB_PASSWORD;
const databaseAndCollection = {db: process.env.MONGO_DB_NAME, collection: process.env.MONGO_COLLECTION};
const { MongoClient, ServerApiVersion } = require('mongodb');
const { connect } = require('http2');

// Mongo DB credentials
const uri = `mongodb+srv://${username}:${password}@cluster0.kp5wsfz.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// Start Mongo DB connection
async function connect(){
	try {
		await client.connect();

		// Routing section start
		// When nothing is specified, display welcome.ejs
		app.get("/", (request, response) => {
			response.render("welcome", {portNumber : portNumber});
		});

		// Processes the actual translations
		app.get("/translate", async (request, response) => {
			let currentUser = request.query.username || "";
			console.log(`Inserting ${currentUser} into database`);

			let originalText = request.query.lang1Text || "";
			let lang2Code = request.query.lang2Code || "";
			let translatedText = "";

			// Translate text
			if (originalText !== ""){
				const options = {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'X-RapidAPI-Key': '42e2f88aa4msh9b9e63c519efcd4p1e7f5bjsn71acb1cbaca4',
						'X-RapidAPI-Host': 'microsoft-translator-text.p.rapidapi.com'
					},
					body: `[{"Text":"${originalText}"}]`
				};

				console.log("executing translation")
				
				// Uses the fetch API to process translation through Microsoft Translate API
				fetch(`https://microsoft-translator-text.p.rapidapi.com/translate?to%5B0%5D=${lang2Code}&api-version=3.0&profanityAction=NoAction&textType=plain`, options)
				.then(response => response.json())
				.then(async result => {
					console.log(result)
					let resultJSON = result[0];
					translatedText = resultJSON.translations[0].text;
			
					let lang1Code = ""
					let lang1 = ""
					let lang2 = ""
			
					// Detects the language of the original text
					const url = 'https://microsoft-translator-text.p.rapidapi.com/Detect?api-version=3.0';
					await fetch(url, options)
						.then(result => result.json())
						.then(json => lang1Code = json[0].language)
						.catch(err => console.error('Error during translation:' + err));

					
					lang1 = await getLanaguage(lang1Code)
					lang2 = await getLanaguage(lang2Code)
			
					console.log(`Original language: ${lang1Code}, ${lang1}`)
					console.log(`Target language: ${lang2Code}, ${lang2}`)
			
					await insertTrans(client, databaseAndCollection, currentUser, {
						lang1 : lang1, 
						originalText : originalText, 
						lang2 : lang2, 
						translatedText: translatedText
					});
			
					console.log(`Translated text: ${translatedText}`)

					response.render("translator", {
						portNumber : portNumber, 
						username : currentUser, 
						originalText : originalText, 
						translatedText:translatedText
					});
				})
				.catch(err =>{ console.error(err)
					response.render("translator", {
						portNumber : portNumber, 
						username : currentUser, 
						originalText : originalText, 
						translatedText : translatedText
					});
				});
			}
			else {
				response.render("translator", {
					portNumber : portNumber, 
					username : currentUser, 
					originalText : originalText, 
					translatedText:translatedText
				});
			}
		});

		app.post("/translate", async (request, response) => {
			let {username, password, originalText} = request.body;
			let currentUser = username || currentUser;
			let translatedText = "";
			// TODO: Make sure to clear the guest history
			console.log(currentUser);
			if(currentUser === "guest"){
				await clearGuestHistory(client, databaseAndCollection);
			}
			const result = await lookupUser(client, databaseAndCollection, currentUser);
			if (result){
				const pass = await matchPassword(client, databaseAndCollection, currentUser, password);
				if (pass) {
					console.log("translate post")
					response.render("translator", {portNumber:portNumber, username:currentUser, originalText:originalText, translatedText:translatedText});
				} else {
					response.render("loginFail");
				}
			} else {
				response.render("signup", {portNumber:portNumber});
			}
		});

		app.get("/signup", (request, response) => {
			response.render("signup", {portNumber:portNumber});
		});

		app.post("/signup", async (request, response) => {
			let {username, password} = request.body;
			console.log("signing up")
			/*
			TODO: search database if username already exists, 
			*/
			// Search database to check if username already exists
			const result = await lookupUser(client, databaseAndCollection, username);
			if(result != null){
				response.render("signupFail", {username:username})
			} else {
				// add the user to the database
				const user = {
					username:username,
					password:password,
					history:[]
				}
				await insertUser(client, databaseAndCollection, user);
				response.render("signupConfirm", {username:username, password: password});
			}
		});

		// Creates a table from a users previous translations and send them in for the get
		async function makeTable(username){
			console.log("username:" + username);
			table = ""
			// create the table here
			// There will always be a user (Guest or an actual one)
			const result = await lookupUser(client, databaseAndCollection, username);
			console.log(result);
			result.history.forEach(elem => {
				table += '<tr>';
				table += `<td>${elem.lang1}</td>`;
				table += `<td>${elem.originalText}</td>`;
				table += `<td>${elem.lang2}</td>`;
				table += `<td>${elem.translatedText}</td>`;
				table += '</tr>';
			})
			return table;
		}

		app.get("/log", async (request, response)=>{
			const username = request.query.username;
			
			table = await makeTable(username);
			response.render("log", {portNumber:portNumber, table:table, username:username});
		});

		app.listen(portNumber);

	} catch(e) {
		console.log(e);
	}}

connect();

// routing section end
// MongoDB section start

// Checks to see if the username exits in the database
async function lookupUser(client, databaseAndCollection, username){
	const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).findOne({username: username});
	return result;
}

// Inserts the username and password into the database
async function insertUser(client, databaseAndCollection, user){
	await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).insertOne(user);
}

// Add new translations into the history of the user
async function insertTrans(client, databaseAndCollection, username, historyTuple){
	await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).updateOne({username: username}, {$push: {history: historyTuple}});
}

// Clear the guest history 
async function clearGuestHistory(client, databaseAndCollection){
	await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).updateOne({username:'guest'}, {$set:{history: []}})
}

// Check if the password matches
async function matchPassword(client, databaseAndCollection, username, password){
	const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).findOne({username: username, password: password});
	return result;
}

// MongtoDB section end

// Get original language from api language code
async function getLanaguage(langCode){
	if (langCode === "af"){
		return "Afrikaans"
	}
	else if (langCode === "sq"){
		return "Albanian"
	}
	else if (langCode === "am"){
		return "Amharic"
	}
	else if (langCode === "ar"){
		return "Arabic"
	}
	else if (langCode === "hy"){
		return "Albanian"
	}
	else if (langCode === "as"){
		return "Assamese"
	}
	else if (langCode === "az"){
		return "Azerbaijani (Latin)"
	}
	else if (langCode === "bn"){
		return "Bangla"
	}
	else if (langCode === "ba"){
		return "Bashkir"
	}
	else if (langCode === "eu"){
		return "Basque"
	}
	else if (langCode === "bs"){
		return "Bosnian (Latin)"
	}
	else if (langCode === "yue"){
		return "Cantonese (Traditional)"
	}
	else if (langCode === "ca"){
		return "Catalan"
	}
	else if (langCode === "lzh"){
		return "Chinese (Literary)"
	}
	else if (langCode === "zh-Hans"){
		return "Chinese Simplified"
	}
	else if (langCode === "zh-Hant"){
		return "Chinese Traditional"
	}
	else if (langCode === "hr"){
		return "Croatian"
	}
	else if (langCode === "cs"){
		return "Czech"
	}
	else if (langCode === "da"){
		return "Danish"
	}
	else if (langCode === "prs"){
		return "Dari"
	}
	else if (langCode === "dv"){
		return "Divehi"
	}
	else if (langCode === "nl"){
		return "Dutch"
	}
	else if (langCode === "en"){
		return "English"
	}
	else if (langCode === "et"){
		return "Estonian"
	}
	else if (langCode === "fo"){
		return "Faroese"
	}
	else if (langCode === "fj"){
		return "Fijian"
	}
	else if (langCode === "fil"){
		return "Filipino"
	}
	else if (langCode === "fi"){
		return "Finnish"
	}
	else if (langCode === "fr"){
		return "French"
	}
	else if (langCode === "fr-ca"){
		return "French (Canada)"
	}
	else if (langCode === "gl"){
		return "Galician"
	}
	else if (langCode === "ka"){
		return "Georgian"
	}
	else if (langCode === "de"){
		return "German"
	}
	else if (langCode === "el"){
		return "Greek"
	}
	else if (langCode === "gu"){
		return "Gujarati"
	}
	else if (langCode === "ht"){
		return "Haitian Creole"
	}
	else if (langCode === "he"){
		return "Hebrew"
	}
	else if (langCode === "hi"){
		return "Hindi"
	}
	else if (langCode === "mww"){
		return "Hmong Daw (Latin)"
	}
	else if (langCode === "hu"){
		return "Hungarian"
	}
	else if (langCode === "is"){
		return "Icelandic"
	}
	else if (langCode === "id"){
		return "Indonesian"
	}
	else if (langCode === "ikt"){
		return "Inuinnaqtun"
	}
	else if (langCode === "iu"){
		return "Inuktitut"
	}
	else if (langCode === "iu-Latn"){
		return "Inuktitut (Latin)"
	}
	else if (langCode === "ga"){
		return "Irish"
	}
	else if (langCode === "it"){
		return "Italian"
	}
	else if (langCode === "ja"){
		return "Japanese"
	}
	else if (langCode === "kn"){
		return "Kannada"
	}
	else if (langCode === "kk"){
		return "Kazakh"
	}
	else if (langCode === "km"){
		return "Khmer"
	}
	else if (langCode === "	tlh-Latn"){
		return "Klingon"
	}
	else if (langCode === "tlh-Piqd"){
		return "Klingon (plqaD)"
	}
	else if (langCode === "ko"){
		return "Korean"
	}
	else if (langCode === "ku"){
		return "Kurdish (Central)"
	}
	else if (langCode === "kmr"){
		return "Kurdish (Northern)"
	}
	else if (langCode === "ky"){
		return "Kyrgyz (Cyrillic)"
	}
	else if (langCode === "lo"){
		return "Lao"
	}
	else if (langCode === "lv"){
		return "Latvian"
	}
	else if (langCode === "lt"){
		return "Lithuanian"
	}
	else if (langCode === "mk"){
		return "Macedonian"
	}
	else if (langCode === "mg"){
		return "Malagasy"
	}
	else if (langCode === "ms"){
		return "Malay (Latin)"
	}
	else if (langCode === "ml"){
		return "Malayalam"
	}
	else if (langCode === "mt"){
		return "Maltese"
	}
	else if (langCode === "	mi"){
		return "Maori"
	}
	else if (langCode === "mr"){
		return "Marathi"
	}
	else if (langCode === "mn-Cyrl"){
		return "Mongolian (Cyrillic)"
	}
	else if (langCode === "mn-Mong"){
		return "Mongolian (Traditional)	"
	}
	else if (langCode === "my"){
		return "Myanmar"
	}
	else if (langCode === "ne"){
		return "Nepali"
	}
	else if (langCode === "nb"){
		return "Norwegian"
	}
	else if (langCode === "or"){
		return "Odia"
	}
	else if (langCode === "ps"){
		return "Pashto"
	}
	else if (langCode === "fa"){
		return "Persian"
	}
	else if (langCode === "pl"){
		return "Polish"
	}
	else if (langCode === "pt"){
		return "Portuguese (Brazil)"
	}
	else if (langCode === "pt-pt"){
		return "Portuguese (Portugal)"
	}
	else if (langCode === "pa"){
		return "Punjabi"
	}
	else if (langCode === "otq"){
		return "Queretaro Otomi"
	}
	else if (langCode === "ro"){
		return "Romanian"
	}
	else if (langCode === "ru"){
		return "Russian"
	}
	else if (langCode === "sm"){
		return "Samoan (Latin)"
	}
	else if (langCode === "sr-Cyrl"){
		return "Serbian (Cyrillic)"
	}
	else if (langCode === "sr-Latn"){
		return "Serbian (Latin)"
	}
	else if (langCode === "sk"){
		return "Slovak"
	}
	else if (langCode === "sl"){
		return "Slovenian"
	}
	else if (langCode === "so"){
		return "Somali (Arabic)"
	}
	else if (langCode === "es"){
		return "Spanish"
	}
	else if (langCode === "sw"){
		return "Swahili (Latin)"
	}
	else if (langCode === "sv"){
		return "Swedish"
	}
	else if (langCode === "ty"){
		return "Tahitian"
	}
	else if (langCode === "ta"){
		return "Tamil"
	}
	else if (langCode === "tt"){
		return "Tatar (Latin)"
	}
	else if (langCode === "te"){
		return "Telugu"
	}
	else if (langCode === "th"){
		return "Thai"
	}
	else if (langCode === "bo"){
		return "Tibetan"
	}
	else if (langCode === "ti"){
		return "Tigrinya"
	}
	else if (langCode === "to"){
		return "Tongan"
	}
	else if (langCode === "tr"){
		return "Turkish"
	}
	else if (langCode === "tk"){
		return "Turkmen (Latin)"
	}
	else if (langCode === "uk"){
		return "Ukrainian"
	}
	else if (langCode === "hsb"){
		return "Upper Sorbian"
	}
	else if (langCode === "ur"){
		return "Urdu"
	}
	else if (langCode === "ug"){
		return "Uyghur (Arabic)"
	}
	else if (langCode === "uz"){
		return "Uzbek (Latin)"
	}
	else if (langCode === ""){
		return "Vietnamese"
	}
	else if (langCode === "vi"){
		return ""
	}
	else if (langCode === "cy"){
		return "Welsh"
	}
	else if (langCode === "yua"){
		return "Yucatec Maya"
	}
	else if (langCode === "zu"){
		return "Zulu"
	}
}