import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pet', {
  hide: () => ipcRenderer.invoke('pet:hide'),
  quit: () => ipcRenderer.invoke('pet:quit'),
  onOpenSettings: (cb: () => void) => {
    ipcRenderer.on('open-settings', cb);
  }
});

export type PetAPI = {
  hide: () => Promise<void>;
  quit: () => Promise<void>;
  onOpenSettings: (cb: () => void) => void;
};
