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
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

// Session-Handling für Login
app.use(session({
    secret: 'supersecretkey',
    resave: false,
    saveUninitialized: false,
}));


const path = require('path');


// Fallback-Route für alle nicht definierten Routen
// NUR statische Dateien bedienen
app.use(express.static(path.join(__dirname, 'public')));

// ❗ Fallback-Route nur für ungültige Pfade
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


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

// WebSocket Events
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
            points, // ✅ Punkte aus der Datenbank holen
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
    });
});


    socket.on('guess', (guess) => {
    const player = players[socket.id];
    if (!player) return;

    if (!words.includes(guess.trim().toLowerCase())) {
        socket.emit('invalidWord', "This word is not in the list!");
        return;
    }

    if (guess === player.selectedWord) {
        let bonusPoints = Math.max(0, 10 - player.attempts);
        player.points += 1 + bonusPoints; // 1 Punkt für das Erraten + Bonuspunkte

        // **🔥 SPEICHERE die Punkte in der Datenbank!**
       db.query(`UPDATE users SET points = $1 WHERE nickname = $2`, [player.points, player.nickname])
    .then(() => console.log(`✅ Punkte von ${player.nickname} aktualisiert: ${player.points}`))
    .catch(err => console.error("❌ Fehler beim Speichern der Punkte:", err));
        });

        player.selectedWord = words[Math.floor(Math.random() * words.length)].trim();
        player.attempts = 0;

        socket.emit('newWord', { wordLength: player.selectedWord.length, bonusPoints: bonusPoints });
        io.emit('updatePlayers', Object.values(players));
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


    socket.on('chatMessage', (message) => {
        const player = players[socket.id];
        if (!player) return;
        io.emit('chatMessage', { nickname: player.nickname, message, color: player.color });
    });

    socket.on('disconnect', () => {
    const player = players[socket.id];
    if (player) {
        console.log(`🚪 Spieler ${player.nickname} hat das Spiel verlassen.`);
        loggedInUsers.delete(player.nickname); // ❗ Entferne User aus der Liste
        delete players[socket.id];
        io.emit('updatePlayers', Object.values(players));
        }
    });
});

// Benutzer registrieren
app.post('/register', (req, res) => {
    const { nickname, password } = req.body;

    if (!nickname || !password) {
        return res.status(400).json({ error: "Nickname and Password required!" });
    }

    if (nickname.length > 12) {
        return res.status(400).json({ error: "The nickname can be a maximum of 12 characters long!" });
    }

    db.get(`SELECT * FROM users WHERE nickname = ?`, [nickname], (err, user) => {
        if (err) return res.status(500).json({ error: "Error validating user" });
        if (user) return res.status(400).json({ error: "Nickname already taken" });

        bcrypt.hash(password, 10, (err, hash) => {
            if (err) return res.status(500).json({ error: "Error hashing password" });

            db.query(`INSERT INTO users (nickname, password, points) VALUES ($1, $2, 0) RETURNING id`, [nickname, hash])
    .then(result => res.json({ message: "Registration successful!", userId: result.rows[0].id }))
    .catch(err => res.status(500).json({ error: "Error saving user" }));
            });
        });
    });
});



// Benutzer einloggen
app.post('/login', (req, res) => {
    const { nickname, password } = req.body;

    // 🔥 Check: Ist der User bereits eingeloggt?
    if (loggedInUsers.has(nickname)) {
        return res.status(400).json({ error: "User is already logged in!" });
    }

   db.query(`SELECT * FROM users WHERE nickname = $1`, [nickname])
    .then(result => {
        const user = result.rows[0];
        if (!user) return res.status(400).json({ error: "User not found" });


        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                req.session.userId = user.id;
                req.session.username = user.nickname;  // 🟢 Speichere Admin-Name
                req.session.save(); // Speichert die Session sicher

                // ✅ Benutzer als "eingeloggt" markieren
                loggedInUsers.add(nickname);

                console.log(`✅ Benutzer eingeloggt: ${user.nickname} (ID: ${user.id})`); // DEBUG
                res.json({ message: "Login successful!", userId: user.id, points: user.points });
            } else {
                res.status(401).json({ error: "Incorrect password" });
            }
        });
    });
});



// Bestenliste abrufen
app.get('/leaderboard', (req, res) => {
    console.log("📢 API-Request: /leaderboard"); // DEBUG
    db.query(`SELECT nickname, points FROM users ORDER BY points DESC LIMIT 5`)
    .then(result => res.json(result.rows))
    .catch(err => res.status(500).json({ error: "Error retrieving leaderboard" }));

        }
        console.log("🏆 Bestenliste geladen:", rows); // DEBUG
        res.json(rows);
    });
});



function checkGuess(guess, selectedWord) {
    const result = [];
    for (let i = 0; i < guess.length; i++) {
        if (guess[i] === selectedWord[i]) {
            result.push('success');
        } else if (selectedWord.includes(guess[i])) {
            result.push('partial');
        } else {
            result.push('fail');
        }
    }
    return result;
}

// 📌 Admin-Funktion: Liste aller registrierten Nutzer abrufen (Nur für Marmor)
app.post('/admin/kick', (req, res) => {
    if (req.session.username !== "Marmor") {  // 🔥 Admin-Prüfung
        return res.status(403).json({ error: "Unauthorized" });
    }

    const { userId } = req.body;
    db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
        if (err) return res.status(500).json({ error: "Error deleting user" });
        res.json({ message: "User kicked successfully!" });
    });
});



// 📌 Admin-Funktion: Benutzer löschen
app.post('/admin/kick', (req, res) => {
    const { userId } = req.body;

    // 🔥 Sicherstellen, dass nur Marmor kicken kann
    db.get(`SELECT nickname FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (err || !user || user.nickname !== "Marmor") {
            return res.status(403).json({ error: "Unauthorized" });
        }

        db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
            if (err) return res.status(500).json({ error: "Error deleting user" });
            res.json({ message: "User kicked successfully!" });
        });
    });
});


app.get('/getUsers', (req, res) => {
    console.log("📢 API-Request: /getUsers"); // DEBUG
    db.all(`SELECT id, nickname FROM users`, [], (err, rows) => {
        if (err) {
            console.error("❌ Fehler beim Abrufen der Benutzer:", err);
            return res.status(500).json({ error: "Error retrieving users" });
        }
        console.log("📋 Benutzerliste geladen:", rows); // DEBUG
        res.json(rows);
    });
});




app.post('/kickUser', (req, res) => {
    const { nickname } = req.body;

    if (!nickname) {
        return res.status(400).json({ error: "Nickname required" });
    }

    // Lösche den User aus der Datenbank
    db.run(`DELETE FROM users WHERE nickname = ?`, [nickname], function(err) {
        if (err) return res.status(500).json({ error: "Error deleting user" });

        // Suche den gekickten Spieler im players-Objekt
        const kickedPlayer = Object.values(players).find(p => p.nickname === nickname);

        if (kickedPlayer) {
            console.log(`🚨 Kicking ${nickname} (${kickedPlayer.id})`);
            io.to(kickedPlayer.id).emit("kicked");  // ❗❗ Sende KICK an den Client
            delete players[kickedPlayer.id];  // ❗❗ Entferne aus Spielerliste
            io.emit('updatePlayers', Object.values(players)); // ❗❗ Aktualisiere die Spielerliste
        }

        res.json({ success: true });
    });
});


const PORT = process.env.PORT || 3000;  // Ändere 10000 zu 3000 als Fallback
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});

