const fs = require('fs');
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Keep all saved data in a `data` folder next to the app (portable) or in `app-data` when developing
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const dataDir = portableDir
    ? path.join(portableDir, 'data')
    : path.join(__dirname, 'app-data');

fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        backgroundColor: '#000000',
        title: 'Trade Journal',
        icon: path.join(__dirname, 'Images/PGTLogo.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Remove menu bar
    Menu.setApplicationMenu(null);

    // Load the dashboard
    win.loadFile('HTML/dashboard.html');

    // Optional: Open DevTools
    // win.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
