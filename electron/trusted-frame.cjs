'use strict'
module.exports = (event, window) => Boolean(window && !window.isDestroyed()
  && event.sender === window.webContents
  && event.senderFrame === window.webContents.mainFrame)
