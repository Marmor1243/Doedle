const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { getDbConnection } = require('./database');
const db = getDbConnection();
const loggedInUsers = new Set();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Falls du eine spezifische URL hast, setze sie hier
        methods: ["GET", "POST"]
    }
});


app.use(express.static('public'));
app.use(express.json());

// Session-Handling für Login
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL, // Stelle sicher, dass du die ENV-Variable gesetzt hast!
    ssl: { rejectUnauthorized: false }
});

app.use(session({
    store: new pgSession({
        pool: pgPool,
        tableName: 'session',
        createTableIfMissing: true // 🟢 Diese Zeile erstellt die Tabelle automatisch!
    }),
    secret: 'supersecretkey',
    resave: false,
    saveUninitialized: false,
}));



const path = require('path');

// Statische Dateien bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Startseite ausliefern
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🔥 Lade die Benutzer aus der Datenbank
db.query(`SELECT id, nickname, points FROM users`)
    .then(result => console.log("📊 Aktuelle Benutzer in der Datenbank:", result.rows))
    .catch(err => console.error("❌ Fehler beim Laden der Benutzer-Tabelle:", err));

const words = fs.readFileSync('words.txt').toString().split("\n");
const players = {};

// Zufällige Farbe für Spieler im Chat
const getRandomColor = () => {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
};

// 🟢 WebSocket Events
io.on('connection', (socket) => {
    console.log('Neuer Spieler verbunden:', socket.id);

    socket.on('setNickname', (nickname) => {
        if (!nickname) return;

        db.query(`SELECT points FROM users WHERE nickname = $1`, [nickname])
            .then(result => {
                const points = result.rows.length > 0 ? result.rows[0].points : 0;

                const playerWord = words[Math.floor(Math.random() * words.length)].trim();
                const color = getRandomColor();
                players[socket.id] = {
                    id: socket.id,
                    nickname,
                    points, 
                    selectedWord: playerWord,
                    attempts: 0,
                    color
                };

                console.log(`${nickname} ist beigetreten. Punkte: ${points}`);

                socket.emit('gameState', {
                    player: players[socket.id],
                    wordLength: players[socket.id].selectedWord.length
                });
                io.emit('updatePlayers', Object.values(players));
            })
            .catch(err => console.error("❌ Fehler beim Abrufen der Punkte:", err));
    });

   socket.on('guess', (guess) => {
    console.log("📨 Server hat einen Guess erhalten:", guess);  // DEBUG-LOG
    const player = players[socket.id];
    if (!player) {
        console.log("⚠️ Spieler nicht gefunden!");
        return;
    }

    console.log(`🎯 ${player.nickname} hat geraten: ${guess}`);

    if (guess === player.selectedWord) {
        let bonusPoints = Math.max(0, 10 - player.attempts);
        player.points += 1 + bonusPoints;

        // ✅ Punkte speichern
        db.query(`UPDATE users SET points = $1 WHERE nickname = $2`, [player.points, player.nickname])
            .then(() => console.log(`✅ Punkte von ${player.nickname} aktualisiert: ${player.points}`))
            .catch(err => console.error("❌ Fehler beim Speichern der Punkte:", err));

        player.selectedWord = words[Math.floor(Math.random() * words.length)].trim();
        player.attempts = 0;

        socket.emit('newWord', { wordLength: player.selectedWord.length, bonusPoints: bonusPoints });
    } else {
        const result = checkGuess(guess, player.selectedWord);
        socket.emit('guessResult', { guess, result });
        player.attempts++;

        if (player.attempts >= 10) {
            player.selectedWord = words[Math.floor(Math.random() * words.length)].trim();
            player.attempts = 0;
            socket.emit('newWord', { wordLength: player.selectedWord.length });
        }
    }

    io.emit('updatePlayers', Object.values(players));
});




    socket.on('disconnect', () => {
        const player = players[socket.id];
        if (player) {
            console.log(`🚪 Spieler ${player.nickname} hat das Spiel verlassen.`);
            loggedInUsers.delete(player.nickname);
            delete players[socket.id];
            io.emit('updatePlayers', Object.values(players));
        }
    });
});

// 🟢 Registrierung
app.post('/register', (req, res) => {
    const { nickname, password } = req.body;

    if (!nickname || !password) {
        return res.status(400).json({ error: "Nickname and Password required!" });
    }

    bcrypt.hash(password, 10)
        .then(hash => {
            return db.query(`INSERT INTO users (nickname, password, points) VALUES ($1, $2, 0) RETURNING id`, [nickname, hash]);
        })
        .then(result => res.json({ message: "Registration successful!", userId: result.rows[0].id }))
        .catch(err => res.status(500).json({ error: "Error saving user" }));
});

// 🟢 Login
app.post('/login', (req, res) => {
    const { nickname, password } = req.body;

    if (loggedInUsers.has(nickname)) {
        return res.status(400).json({ error: "User is already logged in!" });
    }

    db.query(`SELECT * FROM users WHERE nickname = $1`, [nickname])
        .then(result => {
            const user = result.rows[0];
            if (!user) return res.status(400).json({ error: "User not found" });

            return bcrypt.compare(password, user.password)
                .then(match => {
                    if (!match) return res.status(401).json({ error: "Incorrect password" });

                    req.session.userId = user.id;
                    req.session.username = user.nickname;
                    req.session.save();

                    loggedInUsers.add(nickname);
                    res.json({ message: "Login successful!", userId: user.id, points: user.points });
                });
        })
        .catch(err => res.status(500).json({ error: "Error getting user" }));
});

// 🏆 Bestenliste abrufen
app.get('/leaderboard', (req, res) => {
    console.log("📢 API-Request: /leaderboard");
    db.query(`SELECT nickname, points FROM users ORDER BY points DESC LIMIT 5`)
        .then(result => {
            console.log("🏆 Bestenliste geladen:", result.rows); // Debug-Log
            res.json(result.rows);
        })
        .catch(err => {
            console.error("❌ Fehler beim Abrufen der Bestenliste:", err);
            res.status(500).json({ error: "Error retrieving leaderboard" });
        });
});


app.get('/getUsers', (req, res) => {
    db.query(`SELECT id, nickname FROM users`)
        .then(result => res.json(result.rows))
        .catch(err => res.status(500).json({ error: "Error retrieving users" }));
});

// 🔥 Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
