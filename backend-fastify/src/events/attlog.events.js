import { EventEmitter } from 'events';

export const attlogEvents = new EventEmitter();
attlogEvents.setMaxListeners(100);
