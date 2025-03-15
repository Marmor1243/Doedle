const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./database');

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

// Statische Dateien aus dem "public" Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Fallback-Route für alle nicht definierten Routen
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.all(`SELECT * FROM users`, [], (err, rows) => {
    if (err) {
        console.error("Fehler beim Laden der Benutzer-Tabelle:", err);
    } else {
        console.log("Datenbank enthält Benutzer:", rows);
    }
});

db.all(`SELECT id, nickname, points FROM users`, [], (err, rows) => {
    if (err) {
        console.error("❌ Fehler beim Laden der Benutzer-Tabelle:", err);
    } else {
        console.log("📊 Aktuelle Benutzer in der Datenbank:", rows);
    }
});

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

        // Hole Punkte aus der Datenbank
        db.get(`SELECT points FROM users WHERE nickname = ?`, [nickname], (err, row) => {
            const points = row ? row.points : 0;

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

            console.log(`${nickname} ist beigetreten. Wortlänge: ${playerWord.length}, Punkte: ${points}`);

            // Sende das Spiel-Event an den Client
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
            let bonusPoints = Math.max(0, 10 - player.attempts); // Stellt sicher, dass es nicht negativ wird
            player.points += 1 + bonusPoints; // 1 Punkt für das Erraten + Bonuspunkte

            // Punkte in der Datenbank speichern
            db.run(`UPDATE users SET points = ? WHERE nickname = ?`, [player.points, player.nickname], (err) => {
                if (err) {
                    console.error("Fehler beim Speichern der Punkte:", err);
                }
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
        console.log('Spieler hat das Spiel verlassen:', socket.id);
        delete players[socket.id];
        io.emit('updatePlayers', Object.values(players));
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

            db.run(`INSERT INTO users (nickname, password, points) VALUES (?, ?, 0)`, [nickname, hash], function(err) {
                if (err) return res.status(500).json({ error: "Error saving user" });
                res.json({ message: "Registration successful!", userId: this.lastID });
            });
        });
    });
});



// Benutzer einloggen
app.post('/login', (req, res) => {
    const { nickname, password } = req.body;

    db.get(`SELECT * FROM users WHERE nickname = ?`, [nickname], (err, user) => {
        if (err) return res.status(500).json({ error: "Error getting user" });
        if (!user) return res.status(400).json({ error: "User not found" });

        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                req.session.userId = user.id;
                req.session.username = user.nickname;  // 🟢 Speichere Admin-Name
                req.session.save(); // Speichert die Session sicher

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
    db.all(`SELECT nickname, points FROM users ORDER BY points DESC LIMIT 5`, [], (err, rows) => {
        if (err) {
            console.error("❌ Fehler beim Abrufen der Bestenliste:", err);
            return res.status(500).json({ error: "Error retrieving leaderboard" });
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

