import { app } from 'electron';
import { LEGACY_USER_DATA_NAMES, resolveUserData } from './userData';

// Imported first by main.ts: several modules read userData while they load (the native messaging host,
// storage, the single-instance lock), so the folder has to be set before any of them is evaluated.
app.setPath('userData', resolveUserData(app.getPath('appData'), [ app.getName(), ...LEGACY_USER_DATA_NAMES ]));
