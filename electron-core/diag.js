const e = require('electron');
console.log('type:', typeof e);
if (typeof e === 'object') {
  console.log('keys:', Object.keys(e));
  if (e.app) {
    console.log('app type:', typeof e.app);
    console.log('app methods:', Object.getOwnPropertyNames(e.app).slice(0, 20));
    try { console.log('app.getName():', e.app.getName()); } catch(err) { console.log('getName error:', err.message); }
    try { console.log('app.isPackaged:', e.app.isPackaged); } catch(err) { console.log('isPackaged error:', err.message); }
    try { console.log('app.getPath(userData):', e.app.getPath('userData')); } catch(err) { console.log('getPath error:', err.message); }
  }
  if (e.BrowserWindow) {
    console.log('BrowserWindow type:', typeof e.BrowserWindow);
  }
}
