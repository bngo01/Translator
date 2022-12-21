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

// Mongo DB credentials
const uri = `mongodb+srv://${username}:${password}@cluster0.kp5wsfz.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// Start Mongo DB connection
async function hi(){
	try {
		await client.connect();
	} catch(e) {
		console.log(e);
	}}

hi();

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
	let translation = "";
	let targetLang = request.query.lang2 || "";

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
		
		// Uses the fetch API to process translation through Microsoft Translate API
		fetch(`https://microsoft-translator-text.p.rapidapi.com/translate?to%5B0%5D=${targetLang}&api-version=3.0&profanityAction=NoAction&textType=plain`, options)
		.then(response => response.json())
		.then(async result => {
			console.log(res)
			let resultJSON = res[0];
			translation = resultJSON.translations[0].text;
	
			let lang1 = ""
	
			// Detects the language of the original text
			const url = 'https://microsoft-translator-text.p.rapidapi.com/Detect?api-version=3.0';
			await fetch(url, options)
				.then(result => result.json())
				.then(json => {lang1 = json[0].language})
				.catch(err => console.error('error:' + err));
	
			console.log(translation + " " + lang1)
	
			await insertTrans(client, databaseAndCollection, currentUser, {lang1: lang1, originalText : originalText, lang2: targetLang, translation: translation});
	
			console.log(translation)
			response.render("translator", {portNumber:portNumber, username:currentUser, originalText : originalText, translation:translation});
		})
		.catch(err =>{ console.error(err)
			response.render("translator", {portNumber:portNumber, username:currentUser, originalText : originalText, translation:translation});
		});
	} else {
		response.render("translator", {portNumber:portNumber, username:currentUser, originalText : originalText, translation:translation});
	}
});

app.post("/translate", async (request, response) => {
	let {username, password, originalText} = request.body;
	let currentUser = username || currentUser;
	let translation = "";
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
			response.render("translator", {portNumber:portNumber, username:currentUser, originalText:originalText, translation:translation});
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
		table += `<td>${elem.translation}</td>`;
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

//routing section end

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
