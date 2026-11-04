// Tiny pub/sub used between interaction, audio, visuals and UI.
// Events used now:  wind:start, wind:step {deltaForward, progress}, wind:note {index},
//                   wind:idle, progress:full, layout:change {mode}
// Reserved for later scenes: melody:overwind, melody:break, fragment:drag, ...
export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  emit(type, payload) { this.map.get(type)?.forEach((fn) => fn(payload)); }
}
