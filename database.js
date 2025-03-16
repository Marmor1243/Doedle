require('dotenv').config(); // 🚀 Lädt die Umgebungsvariablen

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Aus der .env-Datei
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};

// Funktion zum Erstellen der Benutzertabelle (falls nicht vorhanden)
async function initializeDatabase() {
    try {
        const client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                nickname TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                points INTEGER DEFAULT 0
            );
        `);
        console.log("✅ Benutzertabelle erfolgreich erstellt oder existiert bereits.");
        client.release();
    } catch (err) {
        console.error("❌ Fehler beim Erstellen der Tabelle:", err.message);
    }
}

// Datenbank initialisieren
initializeDatabase();

// Funktion zum Abrufen der Datenbankverbindung
function getDbConnection() {
    return pool;
}

module.exports = { getDbConnection };
