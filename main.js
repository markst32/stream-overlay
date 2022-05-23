const path = require('path');
const fs = require('fs');
const https = require('https');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { app, BrowserWindow, ipcMain, screen, Menu, Tray } = require('electron');
const pkg = require(path.resolve(__dirname, 'package.json'));

const processArgv = hideBin(process.argv);
const argv = yargs(processArgv)
  .scriptName('stream-overlay')
  .usage('$0 [args] <url>')
  .positional('url', {
    describe: 'The URL of the page',
    default: './help.html',
  })
  .option('title', {
    alias: 't',
    type: 'string',
    default: 'Stream Overlay',
    description: 'Window title',
  })
  .option('width', {
    alias: 'w',
    type: 'number',
    default: 450,
    description: 'Window width',
  })
  .option('height', {
    alias: 'h',
    type: 'number',
    default: 650,
    description: 'Window height',
  })
  .option('x', {
    type: 'number',
    default: -1,
    description: 'Window X position (-1 for centered)',
  })
  .option('y', {
    type: 'number',
    default: -1,
    description: 'Window Y position (-1 for centered)',
  })
  .option('opacity', {
    alias: 'o',
    type: 'number',
    default: 1,
    description: 'Window opacity (0 transparent to 1 opaque)',
  })
  .option('fullscreen', {
    alias: 'f',
    type: 'boolean',
    default: false,
    description:
      'Make the window full screen (width, height, x, and y are ignored)',
  })
  .help().argv;

const configured = processArgv.length > 0;
const url = argv._[0] || argv.url;
const { x, y, width, height, title, opacity, fullscreen } = argv;
const wins = [];

ipcMain.handle('requestConfig', (event) => {
  const { win, conf } = wins.find(
    (entry) => event.sender === entry.win.webContents
  );
  win.webContents.send('config', conf);
});
ipcMain.handle('requestClose', (event) => {
  const { win } = wins.find((entry) => event.sender === entry.win.webContents);
  win.close();
});

const createWindow = (conf) => {
  let {
    x = -1,
    y = -1,
    width = 450,
    height = 650,
    title = 'Stream Overlay',
    opacity = 1,
    fullscreen = false,
  } = conf;

  if (width < 45 || height < 30) {
    console.error("You're trying to make the window too small.");
    app.exit(1);
  }

  if (x === -1 || y === -1) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: displayWidth, height: displayHeight } =
      primaryDisplay.workAreaSize;

    if (x === -1) {
      x = Math.max(0, Math.floor(displayWidth / 2 - width / 2));
    }
    if (y === -1) {
      y = Math.max(0, Math.floor(displayHeight / 2 - height / 2));
    }
  }

  let win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'assets', 'preload.js'),
    },
    maximizable: false,
    resizable: false,
    alwaysOnTop: true,
    title,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    movable: true,
    resizable: false,
    skipTaskbar: true,
    opacity,
    fullscreen,
  });

  const timer = setInterval(() => win.moveTop(), 1000);

  win.loadFile('assets/page.html');

  // Emitted when the window is closed.
  win.on('closed', () => {
    clearInterval(timer);

    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    const i = wins.findIndex((entry) => entry.win === win);
    if (i > -1) {
      wins.splice(i, 1);
    }
  });

  const focus = () => {
    win.setIgnoreMouseEvents(false);
    win.setBackgroundColor('#ddd');
    win.webContents.send('focus');
  };
  win.on('focus', focus);

  if (win.isFocused()) {
    focus();
  }

  win.on('blur', () => {
    win.setIgnoreMouseEvents(true);
    win.setBackgroundColor('rgba(0, 0, 0, 0.0)');
    win.webContents.send('blur');
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  // win.webContents.openDevTools();

  wins.push({ win, conf });
};

let config = [];

const createWindows = () => {
  for (let entry of config) {
    createWindow(entry);
  }
};

let tray = null;
app.whenReady().then(() => {
  const configPath = path.resolve(__dirname, 'config.json');
  if (!configured && fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath).toString());
      if (!Array.isArray(userConfig)) {
        throw new Error('Config is not an array.');
      }
      if (userConfig.length < 1) {
        throw new Error('Config array is empty.');
      }
      for (let entry of userConfig) {
        const { url } = entry;
        if (typeof url !== 'string') {
          throw new Error(
            'Config entry is not valid (url is required): ' +
              JSON.stringify(entry)
          );
        }
        config.push(entry);
      }
    } catch (e) {
      console.error('Error reading config file: ' + e);
      app.exit(1);
    }
  } else {
    config.push({ title, url, x, y, width, height, opacity, fullscreen });
  }

  createWindows();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });

  const makeTray = (updateAvailable = false) => {
    if (tray) {
      tray.destroy();
    }
    tray = new Tray(path.resolve(__dirname, 'assets', 'logo.png'));
    const contextMenu = Menu.buildFromTemplate([
      ...config.map((entry, index) => ({
        label: entry.title || 'Window ' + (index + 1),
        click: async () => {
          const { win } = wins.find((check) => entry === check.conf) || {};
          if (win) {
            win.focus();
          } else {
            createWindow(entry);
          }
        },
      })),
      { type: 'separator' },
      {
        label: 'Homepage' + (updateAvailable ? ' (Update Available)' : ''),
        click: async () => {
          const { shell } = require('electron');
          await shell.openExternal('https://github.com/hperrin/stream-overlay');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: async () => {
          app.quit();
        },
      },
    ]);
    tray.setToolTip("SylphWeed's Stream Overlay");
    tray.setContextMenu(contextMenu);
  };

  makeTray();
  const req = https.request(
    {
      hostname: 'github.com',
      port: 443,
      path: '/hperrin/stream-overlay/releases/latest',
      method: 'HEAD',
    },
    (res) => {
      if (
        res.statusCode !== 302 ||
        !res.headers.location.endsWith('v' + pkg.version)
      ) {
        makeTray(true);
      }
    }
  );

  req.on('error', (e) => {
    console.error('Update check error: ', e);
  });
  req.end();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
