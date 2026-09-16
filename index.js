const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// Requirements
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const autoUpdater                       = require('electron-updater').autoUpdater
const ejse                              = require('ejs-electron')
const fs                                = require('fs')
const http                              = require('http')
const https                             = require('https')
const isDev                             = require('./app/assets/js/isdev')
const path                              = require('path')
const semver                            = require('semver')
const { pathToFileURL }                 = require('url')
const { AZURE_CLIENT_ID, AZURE_BROWSER_CLIENT_ID, MSFT_LOGIN_IN_BROWSER, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')

// Setup Lang
LangLoader.setupLanguage()

// Setup auto updater.
function initAutoUpdater(event, data) {

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }
    autoUpdater.on('update-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        event.sender.send('autoUpdateNotification', 'update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        event.sender.send('autoUpdateNotification', 'update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        event.sender.send('autoUpdateNotification', 'checking-for-update')
    })
    autoUpdater.on('download-progress', (progress) => {
        event.sender.send('autoUpdateNotification', 'download-progress', progress)
    })
    autoUpdater.on('error', (err) => {
        event.sender.send('autoUpdateNotification', 'realerror', err)
    }) 
}

// Near-instant update detection while the launcher is open: poll the tiny latest.yml
// (HEAD request, ~200 bytes) every 30 s and only run the real update check when its
// ETag/Last-Modified changes. Also re-check whenever the window regains focus.
const UPDATE_FEED_URL = 'https://launcher.dodoshield.com/updates/latest.yml'
let updateFeedTag = null
let updateFeedTimer
function startUpdateFeedWatch(sender) {
    if (updateFeedTimer) return
    const probe = () => {
        const req = https.request(UPDATE_FEED_URL, { method: 'HEAD', timeout: 8000 }, res => {
            const tag = (res.headers.etag || '') + '|' + (res.headers['last-modified'] || '')
            res.resume()
            if (updateFeedTag === null) { updateFeedTag = tag; return }
            if (tag !== updateFeedTag) {
                updateFeedTag = tag
                console.log('Update feed changed, checking for update.')
                autoUpdater.checkForUpdates().catch(err => sender.send('autoUpdateNotification', 'realerror', err))
            }
        })
        req.on('timeout', () => req.destroy())
        req.on('error', () => { /* offline; try again next tick */ })
        req.end()
    }
    updateFeedTimer = setInterval(probe, 30000)
    probe()
    app.on('browser-window-focus', () => probe())
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(event, data)
            startUpdateFeedWatch(event.sender)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall(true, true)
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


// Microsoft Auth Login
//
// Two flows, selected by MSFT_LOGIN_IN_BROWSER:
//  - embedded: Microsoft's sign-in page in an Electron window, nativeclient redirect
//    (works with any client id, including the public Helios one).
//  - browser: the sign-in page opens in the user's default browser and the auth code
//    comes back to a one-shot loopback HTTP listener. Requires http://localhost to be
//    registered on the Azure app as a "Mobile and desktop applications" redirect URI.
const MSFT_NATIVE_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const MSFT_LOOPBACK_PORTS = [61817, 61818, 61819, 0]
const MSFT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000
let msftAuthServer
let msftAuthWindow
let msftAuthViewOnClose

function msftAuthorizeUrl(redirectUri, clientId) {
    return 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
        + `?prompt=select_account&client_id=${clientId}&response_type=code`
        + '&scope=XboxLive.signin%20offline_access'
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
}

function openEmbeddedMicrosoftLogin(ipcEvent, viewSuccess) {
    let success = false
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle')
    })
    msftAuthWindow.on('closed', () => { msftAuthWindow = undefined })
    msftAuthWindow.on('close', () => {
        if (!success) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })
    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(MSFT_NATIVE_REDIRECT_URI + '?')) {
            const queryMap = { client_id: AZURE_CLIENT_ID }
            new URL(uri).searchParams.forEach((v, k) => { queryMap[k] = v })
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, viewSuccess)
            success = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })
    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(msftAuthorizeUrl(MSFT_NATIVE_REDIRECT_URI, AZURE_CLIENT_ID))
}

function listenOnFirstFreePort(server, ports) {
    return new Promise((resolve, reject) => {
        const tryPort = (i) => {
            if (i >= ports.length) return reject(new Error('No loopback port available'))
            server.once('error', () => tryPort(i + 1))
            server.listen(ports[i], '127.0.0.1', () => {
                server.removeAllListeners('error')
                resolve(server.address().port)
            })
        }
        tryPort(0)
    })
}

ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, async (ipcEvent, ...arguments_) => {
    if (msftAuthServer || msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    const msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    // Third argument forces the embedded flow (used as fallback when the browser flow
    // signs in fine but the Minecraft API rejects the DodoShield client id).
    const forceEmbedded = arguments_[2] === true

    if (!MSFT_LOGIN_IN_BROWSER || forceEmbedded) {
        openEmbeddedMicrosoftLogin(ipcEvent, msftAuthViewSuccess)
        return
    }

    let finished = false
    let timeout
    const finish = (replyType, payload, view) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, replyType, payload, view)
        const s = msftAuthServer
        msftAuthServer = undefined
        if (s) s.close()
    }

    msftAuthServer = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1')
        // Azure matches the loopback redirect on path too, so the registered
        // http://localhost (no path) means the code arrives at '/'.
        if (url.pathname !== '/') {
            res.writeHead(404).end()
            return
        }
        const queryMap = {
            redirect_uri: redirectUri,
            client_id: AZURE_BROWSER_CLIENT_ID,
            view_success: msftAuthViewSuccess,
            view_close: msftAuthViewOnClose
        }
        url.searchParams.forEach((v, k) => { queryMap[k] = v })
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(LangLoader.queryJS('index.microsoftLoginBrowserDone'))
        finish(MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)
    })

    let redirectUri
    try {
        const port = await listenOnFirstFreePort(msftAuthServer, MSFT_LOOPBACK_PORTS)
        redirectUri = `http://localhost:${port}`
    } catch (err) {
        console.error('Microsoft login: could not open loopback listener', err)
        finish(MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        return
    }

    timeout = setTimeout(() => finish(MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose), MSFT_LOGIN_TIMEOUT_MS)

    shell.openExternal(msftAuthorizeUrl(redirectUri, AZURE_BROWSER_CLIENT_ID))
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('SealCircle')
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('SealCircle'),
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)

    const data = {
        bkid: Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)),
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejse.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    // Fixed window size: the layout is designed for 980x552 and breaks when shrunk.
    win.resizable = false
    win.setMaximizable(false)
    win.setFullScreenable(false)

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

// Dev only: run a second instance next to the installed launcher with its own user data.
if (isDev && process.env.DODO_USER_DATA) {
    app.setPath('userData', process.env.DODO_USER_DATA)
}

// Only one launcher instance at a time; a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore()
            win.focus()
        }
    })
    app.on('ready', createWindow)
    app.on('ready', createMenu)
}

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})
