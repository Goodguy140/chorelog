/** Avoid circular imports between preset saves and the full render implementation. */
let renderImpl = () => {};

export function setRenderRenderer(fn) {
  renderImpl = fn;
}

export function render() {
  renderImpl();
}
