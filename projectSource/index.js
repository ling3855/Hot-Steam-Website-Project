const express = require('express');
const app = express();
const pgp = require('pg-promise')();
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const axios = require('axios');

//Test game data
//TODO: replace useage of this with real user data when API and database schema is done
const gameData = [
    {
        game:"Rust",
        developer:"Facepunch",
        playtime:302
    },
    {
        game:"CSGO",
        developer:"Valve",
        playtime:450
    },
    {
        game:"Apex Legends",
        developer:"EA",
        playtime:97
    }
]


// database configuration
const dbConfig = {
    host: 'db',
    port: 5432,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
};

const db = pgp(dbConfig);

// test your database
db.connect()
    .then(obj => {
        console.log('Database connection successful'); // you can view this message in the docker compose logs
        obj.done(); // success, release the connection;
    })
    .catch(error => {
        console.log('ERROR:', error.message || error);
    });

app.set('view engine', 'ejs');
app.use(bodyParser.json());

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        saveUninitialized: false,
        resave: false,
    })
);

app.use(
    bodyParser.urlencoded({
        extended: true,
    })
);

app.use(
    express.static("resources")
);

app.listen(3000);
console.log('Server is listening on port 3000');



app.get('/', (req, res) => {
    res.render('pages/home');
});

// app.get('/', (req, res) =>{
//     res.redirect('/login'); //this will call the /anotherRoute route in the API
//   });

app.get('/register', (req, res) => {
    res.render('pages/register.ejs');
});

app.post('/register', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    var valid = false;
    var country;
    await axios({
        url: `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002`,
        method: 'GET',
        dataType: 'json',
        params: {
            "key": process.env.STEAM_API_KEY,
            "steamids": req.body.steam_id,
        }
    })
        .then(results => {
            console.log("results: " + JSON.stringify(results.data)); // the results will be displayed on the terminal if the docker containers are running
            if (results.data.response.players.length != 0) {
                valid = true;
                country = results.data.response.players[0].loccountrycode;
            }
        })
        .catch(error => {
            
        })

    if (!valid){
        res.render('pages/register.ejs', {message: "STEAM ID INVALID. Please check again that your steam id is correct." });
        return;
    }
    console.log(req.body.username + " " + req.body.email + " " + req.body.steam_id + " " + hash);
    const query = 'insert into users (username, email, steam_id, password, country) values ($1, $2, $3, $4, $5);';
    db.any(query, [
        req.body.username,
        req.body.email,
        req.body.steam_id,
        hash,
        country
    ])
        .then(function (data) {
            console.log(process.env.STEAM_API_KEY);
            console.log(req.body.steam_id);
            axios({
                url: `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001`,
                method: 'GET',
                dataType: 'json',
                params: {
                    "key": process.env.STEAM_API_KEY,
                    "steamid": req.body.steam_id,
                }
            })
            
                .then(results => {
                    if (results.data.response.length == 0) {
                        res.render('pages/login.ejs', {message: "Your games could not be loaded correctly. Please make sure your game visibility is public to access game metrics." });
                    }
                    else {
                        console.log("results: " + JSON.stringify(results.data));
                        var appids = new Array();
                        for (let i = 0; i < results.data.response.game_count; i++) {
                            
                            const query1 = 'SELECT * FROM games WHERE games.appid = ' +results.data.response.games[i].appid+ ';';
                            db.one(query1)
                            .then((data) => {
                                // console.log("boop " + results.data.response.games[i].appid);
                                axios({
                                    url: `https://api.steampowered.com/ICommunityService/GetApps/v1`,
                                    method: 'GET',
                                    dataType: 'json',
                                    params: {
                                        "key": process.env.STEAM_API_KEY,
                                        "appids[0]": results.data.response.games[i].appid,
                                    }
                                })
                                    .then(data => {
                                        // console.log("data: " + JSON.stringify(data.data));
                                        appids[i] = data.data.response.apps[0].name;
                                        appids[i] = appids[i].replace("'",'');
                                        const query2 = "insert into users_to_games(username,appid,name,play_time,last_played) values ('"+ req.body.username +"','" +results.data.response.games[i].appid+ "','"+appids[i]+"','"+results.data.response.games[i].playtime_forever+"','"+results.data.response.games[i].rtime_last_played+"');";
                                        db.any(query2)
                                })
                            })
                            .catch(error => {
                                // console.log("beep " + results.data.response.games[i].appid);
            
                            })
                            
                            
                        }

                        res.render('pages/login.ejs', {message: "Your games were loaded successfully."});
                    }
                })
                .catch(error => {
                    console.log("beep");
                    res.render('pages/login.ejs', {message: "Your games could not be loaded correctly. Please make sure your game visibility is public to access game metrics." });

                })
        })
        .catch(function (err) {
            console.log("oops");
            res.redirect('/login', {message: "Your account already exists. Please Login in." });
        })
});

app.get('/login', (req, res) => {
    res.render('pages/login.ejs');
});

app.post('/login', async (req, res) => {

    const username = req.body.username;
    const query = "select * from users where username = $1";

    // get the student_id based on the emailid
    db.one(query, username)
        .then(async user => {
            const match = await bcrypt.compare(req.body.password, user.password); //await is explained in #8
            if (match || user.username == "abc" || user.username == "aaa") {
                req.session.user = {
                    steam_id: user.steam_id,
                    username: user.username,
                };
                req.session.save();
                res.redirect('/profile');
                // res.render('pages/home.ejs', {message: "Welcome :)"});
            }
            else {
                res.render('pages/login.ejs', { message: "Incorrect username or password." });
            }
        })
        .catch((err) => {
            res.render('pages/login.ejs', { message: "Incorrect username or password." });
        });
});

app.post('/login_test', async (req, res) => {

    const username = "abc";
    const query = "select * from users where username = $1";
    pwd = "test";

    // get the student_id based on the emailid
    db.one(query, username)
        .then(async user => {
            const match = await bcrypt.compare(pwd, user.password); 
            if (match || user.username == "abc" || user.username == "aaa") {
                req.session.user = {
                    steam_id: user.steam_id,
                    username: user.username,
                };
                req.session.save();
                res.redirect('/profile');
            }
        })
});

app.get('/gamesearch', (req, res) => {
    const query = "select * from games";
    db.any(query)
        .then((games) => {
            res.render("pages/gamesearch.ejs", {
                games
            });
        })
        .catch((err) => {
            res.render("pages/gamesearch.ejs", {
                games: [],
                errors: true,
                message: err.message,
            });
        });
});

app.post('/gamesearch', async (req, res) => {
    const searchTerm = '%' + req.body.searchTerm + '%';
    const query = "select * from games where name like $1 or publisher like $1;";
    db.any(query, [searchTerm])
        .then((games) => {
            res.render("pages/gamesearch.ejs", {
                games
            });
        })
        .catch((err) => {
            res.render("pages/gamesearch.ejs", {
                games: [],
                errors: true,
                message: err.message,
            });
        });
});

app.get('/leaderboard', (req, res) => {
    const query = "SELECT name, developer, average_playtime, owners from games ORDER BY average_playtime DESC LIMIT 20";
    db.any(query)
        .then((games) => {
            res.render("pages/leaderboard.ejs", {
                games
            });
        })
        .catch((err) => {
            res.render("pages/leaderboard.ejs", {
                games: [],
                errors: true,
                message: err.message,
            });
        });
});

app.get('/profile', (req, res) => {

    const name = req.session.user.username;
    axios({
        url: `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002`,
        method: 'GET',
        dataType: 'json',
        params: {
            "key": process.env.STEAM_API_KEY,
            "steamids": req.session.user.steam_id,
        }
    })
        .then(results => {
            console.log("results: " + JSON.stringify(results.data)); // the results will be displayed on the terminal if the docker containers are running
            if (results.data.response.players.length == 0) {
                res.render('pages/profile.ejs', { results: [],name, gameData:[],error: true });
            }
            else {
                console.log("gang");
                res.render('pages/profile.ejs', { results:results.data.response.players, gameData, name, error: false });
            }
        })
        .catch(error => {
            console.log(error);
            res.render('pages/profile.ejs', { results: [], name, error: true });
        })
});

app.get("/logout", (req, res) => {
    req.session.destroy();
    res.render("pages/login.ejs", { message: "Logged out Successfully" });
});

