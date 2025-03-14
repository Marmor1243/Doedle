const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error("Fehler beim Verbinden zur Datenbank:", err.message);
    } else {
        console.log("Verbindung zur SQLite-Datenbank erfolgreich!");
    }
});

// Benutzertabelle ERZWUNGEN erstellen, falls sie nicht existiert
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
                                             id INTEGER PRIMARY KEY AUTOINCREMENT,
                                             nickname TEXT UNIQUE NOT NULL,
                                             password TEXT NOT NULL,
                                             points INTEGER DEFAULT 0
        )
    `, (err) => {
        if (err) {
            console.error("Fehler beim Erstellen der Benutzertabelle:", err.message);
        } else {
            console.log("Benutzertabelle erfolgreich erstellt oder existiert bereits.");
        }
    });
});

// Falls es doch ein Problem gibt, Tabelle neu erstellen
function resetDatabase() {
    db.serialize(() => {
        db.run("DROP TABLE IF EXISTS users");
        db.run(`
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                points INTEGER DEFAULT 0
            )
        `, (err) => {
            if (err) {
                console.error("Fehler beim Neuerstellen der Benutzertabelle:", err.message);
            } else {
                console.log("Benutzertabelle wurde neu erstellt!");
            }
        });
    });
}

module.exports = db;
