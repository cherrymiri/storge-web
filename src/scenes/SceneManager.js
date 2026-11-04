/**
 * Runs one scene at a time. A scene is an object with
 *   enter(ctx) / update(dt, now) / layout(info) / exit()
 * The six scenes of STORGE plug in here; only 01 is implemented for now.
 */
export class SceneManager {
  constructor(ctx) { this.ctx = ctx; this.current = null; this.registry = new Map(); }
  register(id, factory) { this.registry.set(id, factory); }
  async go(id) {
    const factory = this.registry.get(id);
    if (!factory) throw new Error(`scene ${id} not implemented yet`);
    await this.current?.exit?.();
    this.current = factory(this.ctx);
    await this.current.enter?.();
    this.ctx.bus.emit('scene:enter', { id });
  }
  update(dt, now) { this.current?.update?.(dt, now); }
  layout(info) { this.current?.layout?.(info); }
}
