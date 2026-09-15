// Azure app registrations used for Microsoft sign-in.
//  - AZURE_CLIENT_ID: public Helios Launcher id. Only allows the embedded-window flow
//    (nativeclient redirect) but is already approved by Mojang for the Minecraft API.
//  - AZURE_BROWSER_CLIENT_ID: DodoShield's own registration with http://localhost as a
//    Mobile/desktop redirect URI, used for sign-in through the system browser.
// MSFT_LOGIN_IN_BROWSER selects the browser flow first; if Mojang has not (yet) approved
// the DodoShield id, the launcher falls back to the embedded flow automatically.
exports.AZURE_CLIENT_ID = '1ce6e35a-126f-48fd-97fb-54d143ac6d45'
exports.AZURE_BROWSER_CLIENT_ID = 'bf3ac53c-f5e4-49d3-8bed-abbc72f7f4d3'
exports.MSFT_LOGIN_IN_BROWSER = true


// Opcodes
exports.MSFT_OPCODE = {
    OPEN_LOGIN: 'MSFT_AUTH_OPEN_LOGIN',
    OPEN_LOGOUT: 'MSFT_AUTH_OPEN_LOGOUT',
    REPLY_LOGIN: 'MSFT_AUTH_REPLY_LOGIN',
    REPLY_LOGOUT: 'MSFT_AUTH_REPLY_LOGOUT'
}
// Reply types for REPLY opcode.
exports.MSFT_REPLY_TYPE = {
    SUCCESS: 'MSFT_AUTH_REPLY_SUCCESS',
    ERROR: 'MSFT_AUTH_REPLY_ERROR'
}
// Error types for ERROR reply.
exports.MSFT_ERROR = {
    ALREADY_OPEN: 'MSFT_AUTH_ERR_ALREADY_OPEN',
    NOT_FINISHED: 'MSFT_AUTH_ERR_NOT_FINISHED'
}

exports.SHELL_OPCODE = {
    TRASH_ITEM: 'TRASH_ITEM'
}