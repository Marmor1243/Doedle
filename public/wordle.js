const socket = io();

let wordLength = 5;
let currentGuess = '';
let currentRow = 0;
let isProcessingGuess = false; // Blockiert Eingabe bis Feedback kommt

const board = document.getElementById('board');
const keyboard = document.getElementById('keyboard');
const playerList = document.getElementById('playerList');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const loginScreen = document.getElementById('nicknameInput');
const gameScreen = document.getElementById('game');

// Login-Prozess: Nach erfolgreichem Login das Spielfeld anzeigen
function loginUser() {
    const nickname = document.getElementById('nickname').value;
    const password = document.getElementById('password').value;

    fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert("Error: " + data.error);
            } else {
                alert("Welcome, " + nickname + "!");

                // Spiel starten
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('game').style.display = 'flex';

                // Spieler-Event senden
                socket.emit('setNickname', nickname);

                // ✅ Admin-Check NUR für den eigenen Nutzer ausführen!
                setTimeout(() => {
                    checkAdmin(nickname);
                }, 1000);
            }
        })
        .catch(error => console.error("Login-Error:", error));
}

setTimeout(() => {
    updateLeaderboard();
    loadUserList();
}, 2000);





function registerUser() {
    const nickname = document.getElementById('nickname').value;
    const password = document.getElementById('password').value;

    if (nickname.length > 12) {
        alert("The nickname can be a maximum of 12 characters long.");
        return;
    }

    fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert("Error: " + data.error);
            } else {
                alert("Registration successful! Please log in.");
                document.getElementById('nickname').value = "";
                document.getElementById('password').value = "";
            }
        })
        .catch(error => console.error("Registration error:", error));
}

// Sobald das `gameState`-Event empfangen wird, das Spielfeld anzeigen
socket.on('gameState', ({ wordLength: newWordLength }) => {
    wordLength = newWordLength;
    createBoard(wordLength);
    createKeyboard();
});

// Server sendet das Ergebnis des geratenen Wortes
socket.on('guessResult', ({ guess, result }) => {
    revealGuess(guess, result);
    updateKeyboard(guess, result);
    isProcessingGuess = false; // Spieler kann das nächste Wort raten
});

// Neues Wort starten
// Wenn ein neues Wort kommt, setze das Spielfeld zurück
socket.on('newWord', ({ wordLength, bonusPoints }) => {
    alert(`Well done! You got ${1 + bonusPoints} Points!`);
    resetBoard();
    isProcessingGuess = false; // Entsperrt das Spiel
});


// Spieler-Liste aktualisieren
socket.on('updatePlayers', (players) => {
    const playerListDiv = document.getElementById('playersList'); // Login-Screen
    const gamePlayerDiv = document.getElementById('playerList');  // Im Spiel

    if (!playerListDiv || !gamePlayerDiv) return;

    let playerHTML = "";

    if (players.length === 0) {
        playerHTML = "<div class='no-players'>No players online</div>";
    } else {
        players.forEach(player => {
            playerHTML += `<div style="color: ${player.color}; font-weight: bold;">${player.nickname}: ${player.points} Punkte</div>`;
        });
    }

    playerListDiv.innerHTML = playerHTML;
    gamePlayerDiv.innerHTML = playerHTML;

    // 🚀 WICHTIG: Admin-Panel wird NICHT hier aufgerufen, sonst sehen es alle Spieler
});

socket.on("kicked", () => {
    alert("You have been kicked by the admin.");
    socket.disconnect(); // ❗❗ Trennt die Verbindung zum Server
    location.reload();   // ❗❗ Leitet zurück zum Login-Screen
});




// Chatnachrichten anzeigen
socket.on('chatMessage', (data) => {
    const messageElement = document.createElement('div');
    messageElement.textContent = `${data.nickname}: ${data.message}`;
    messageElement.style.color = data.color;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
});
socket.on('invalidWord', (message) => {
    alert(message);
    isProcessingGuess = false; // Entsperrt die Eingabe für den nächsten Versuch
});
// Erstellt das Wordle-Spielbrett
function createBoard(length) {
    board.innerHTML = '';
    for (let i = 0; i < 10; i++) {
        const row = document.createElement('tr');
        for (let j = 0; j < length; j++) {
            const cell = document.createElement('td');
            cell.className = 'default'; // Setzt den Standardstil
            row.appendChild(cell);
        }
        board.appendChild(row);
    }
}

// Erstellt die Bildschirmtastatur
function createKeyboard() {
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    keyboard.innerHTML = '';
    letters.forEach(letter => {
        const key = document.createElement('div');
        key.className = 'key';
        key.textContent = letter;
        key.dataset.key = letter;
        key.onclick = () => handleKey(letter);
        keyboard.appendChild(key);
    });

    const enterKey = document.createElement('div');
    enterKey.className = 'key';
    enterKey.textContent = 'Enter';
    enterKey.dataset.key = 'Enter';
    enterKey.onclick = () => handleKey('Enter');
    keyboard.appendChild(enterKey);

    const backspaceKey = document.createElement('div');
    backspaceKey.className = 'key';
    backspaceKey.textContent = 'Backspace';
    backspaceKey.dataset.key = 'Backspace';
    backspaceKey.onclick = () => handleKey('Backspace');
    keyboard.appendChild(backspaceKey);
}

// Verarbeitet Tastatureingaben (Check: Ist Chat aktiv?)
function handleKey(key) {
    if (document.activeElement === chatInput) return;
    if (isProcessingGuess) return;

    if (key === 'Enter') {
        if (currentGuess.length === wordLength) {
            console.log("📩 Sende Guess an Server:", currentGuess);  // DEBUG-LOG
            socket.emit('guess', currentGuess);
            isProcessingGuess = true;
        } else {
            console.log("⚠️ Nicht genug Buchstaben eingegeben!");
        }
    } else if (key === 'Backspace') {
        currentGuess = currentGuess.slice(0, -1);
    } else if (currentGuess.length < wordLength && /^[a-zA-Z]$/.test(key)) {
        currentGuess += key;
    }
    updateBoard();
}


// Aktualisiert das Spielfeld mit dem aktuellen Wortversuch
function updateBoard() {
    const row = board.rows[currentRow];
    if (!row) return;
    for (let i = 0; i < wordLength; i++) {
        const cell = row.cells[i];
        cell.textContent = currentGuess[i] || '';
    }
}

// Zeigt das Ergebnis eines Rates an (Fix: Buchstaben verschwinden nicht mehr!)
function revealGuess(guess, result) {
    const row = board.rows[currentRow];
    if (!row) return;

    for (let i = 0; i < wordLength; i++) {
        const cell = row.cells[i];

        // **Stelle sicher, dass der Buchstabe erhalten bleibt**
        if (!cell.textContent) {
            cell.textContent = guess[i];
        }

        // **Setze Farben entsprechend des Ergebnisses**
        cell.classList.remove('default', 'success', 'partial', 'fail'); // Entferne alte Klassen
        if (result[i] === 'success') {
            cell.classList.add('success');
        } else if (result[i] === 'partial') {
            cell.classList.add('partial');
        } else {
            cell.classList.add('fail');
        }
    }

    currentRow++; // Wechsle zur nächsten Zeile
    currentGuess = '';
}

function resetBoard() {
    currentRow = 0;
    currentGuess = '';
    createBoard(wordLength);
    createKeyboard();
}


// Aktualisiert die Bildschirmtastatur nach einem Versuch
function updateKeyboard(guess, result) {
    for (let i = 0; i < guess.length; i++) {
        const letter = guess[i];
        const key = document.querySelector(`.key[data-key="${letter}"]`);
        if (key) {
            if (result[i] === 'success') {
                key.classList.remove('partial', 'fail');
                key.classList.add('success');
            } else if (result[i] === 'partial') {
                key.classList.remove('success', 'fail');
                key.classList.add('partial');
            } else {
                key.classList.remove('success', 'partial');
                key.classList.add('fail');
            }
        }
    }
}

// Chat-Nachricht senden (Fix: Enter im Chat funktioniert)
chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
    }
});

// Sendet eine Chatnachricht
function sendMessage() {
    const message = chatInput.value;
    if (message) {
        socket.emit('chatMessage', message);
        chatInput.value = '';
    }
}

// Bestenliste abrufen und anzeigen
function updateLeaderboard() {
    console.log("Lade Bestenliste...");
console.log("📢 Lade Bestenliste...");
fetch('/leaderboard')
    .then(response => response.json())
    .then(players => {
        console.log("🏆 Bestenliste erhalten:", players);
        const leaderboardList = document.getElementById('leaderboardList');
        if (!leaderboardList) {
            console.error("❌ leaderboardList nicht gefunden!");
            return;
        }
        leaderboardList.innerHTML = "";

        if (players.length === 0) {
            leaderboardList.innerHTML = "<li>No players in the leaderboard yet</li>";
            return;
        }

        // 🏆 Pokale für die Top 5 Spieler
        const trophies = ["🏆", "🥈", "🥉", "4️⃣", "5️⃣"];
        players.forEach((player, index) => {
            const playerEntry = document.createElement('li');
            playerEntry.innerHTML = `${trophies[index]} <strong>${player.nickname}</strong>: ${player.points} Punkte`;
            leaderboardList.appendChild(playerEntry);
        });
    })
    .catch(error => console.error("❌ Fehler beim Laden der Bestenliste:", error));

}

setInterval(updateLeaderboard, 10000); // Alle 10 Sek. aktualisieren


// 📌 Admin-Check: Zeige den "Kick Users"-Button nur für Marmor
function checkAdmin(nickname) {
    const adminPanel = document.getElementById("adminPanel");
    if (!adminPanel) return;

    console.log(`checkAdmin() wurde aufgerufen für: ${nickname}`); // DEBUG

    if (nickname === "Marmor") {
        console.log("✅ Marmor erkannt! Zeige Admin-Panel."); // DEBUG
        adminPanel.style.display = "block";  // Nur für Marmor sichtbar
    } else {
        console.log("❌ Kein Admin! Verstecke Admin-Panel."); // DEBUG
        adminPanel.style.display = "none";   // Für alle anderen unsichtbar
    }
}







// 📌 Admin: Registrierte User abrufen und anzeigen
document.getElementById("toggleKickList").addEventListener("click", () => {
    const userList = document.getElementById("userList");

    if (userList.style.display === "none" || userList.style.display === "") {
        userList.style.display = "block";
        loadUserList();
    } else {
        userList.style.display = "none";
    }
});


// 📌 Admin: User kicken
document.getElementById('toggleKickList').addEventListener('click', () => {
    const userList = document.getElementById('userList');
    if (userList.style.display === 'none' || userList.style.display === '') {
        userList.style.display = 'block';
        loadUserList();
    } else {
        userList.style.display = 'none';
    }
});

document.getElementById('hideKickList').addEventListener('click', () => {
    document.getElementById('userList').style.display = 'none';
});


// Lädt registrierte User aus der Datenbank
// Lädt registrierte User aus der Datenbank
function loadUserList() {
    console.log("Lade registrierte User...");
console.log("📢 Lade registrierte User...");
fetch('/getUsers')
    .then(response => response.json())
    .then(users => {
        console.log("📋 Registrierte User erhalten:", users);

        const userList = document.getElementById('userListContent');
        if (!userList) {
            console.error("❌ userListContent nicht gefunden!");
            return;
        }
        userList.innerHTML = "";

        if (users.length === 0) {
            userList.innerHTML = "<li>No registered users found</li>";
            return;
        }

        users.forEach(user => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `${user.nickname} <button class="kick-button" onclick="kickUser('${user.nickname}')">Kick</button>`;
            userList.appendChild(listItem);
        });
    })
    .catch(error => console.error("❌ Fehler beim Laden der Userliste:", error));

}


// Sendet Kick-Befehl an den Server
function kickUser(nickname) {
    if (confirm(`Are you sure you want to kick ${nickname}?`)) {
        fetch('/kickUser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert(`${nickname} has been kicked.`);
                    loadUserList(); // Liste neu laden
                } else {
                    alert("Error: " + data.error);
                }
            })
            .catch(error => console.error("Error kicking user:", error));
    }
}


// 📌 Gekickte User trennen
socket.on("kicked", () => {
    alert("You have been kicked by the admin.");
    location.reload(); // Trennt den Spieler
});

// Bestenliste beim Laden abrufen
updateLeaderboard();

// Bestenliste alle 10 Sekunden aktualisieren
setInterval(updateLeaderboard, 10000);


// Unterstützt echte Tastatur-Eingabe für das Spiel
document.addEventListener("DOMContentLoaded", () => {
    const toggleKickListButton = document.getElementById("toggleKickList");
    const userListDiv = document.getElementById("userList");

    if (!toggleKickListButton || !userListDiv) {
        console.error("Admin-Panel oder User-Liste nicht gefunden!");
        return;
    }

    toggleKickListButton.addEventListener("click", () => {
        console.log("Button wurde geklickt!"); // DEBUG
        if (userListDiv.style.display === "none" || userListDiv.style.display === "") {
            userListDiv.style.display = "block";
            loadUserList();
        } else {
            userListDiv.style.display = "none";
        }
    });
});

document.addEventListener('keydown', (event) => {
    const chatInput = document.getElementById("chatInput");

    // Wenn der Chat gerade aktiv ist, ignorieren wir die Eingabe fürs Spielfeld
    if (document.activeElement === chatInput) {
        return;
    }

    // Falls nicht, wird die Taste ins Spielfeld übernommen
    handleKey(event.key);
});

document.getElementById("board").addEventListener("click", () => {
    document.getElementById("chatInput").blur(); // Entfernt den Fokus vom Chat
});


