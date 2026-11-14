// Keyboard state: isDown() for held keys, pressed() for one-shot presses (consumed on read).
class Input {
  constructor() {
    this.down = new Set();
    this.justPressed = new Set();

    window.addEventListener('keydown', (e) => {
      // Typing into a text field (e.g. the username input): let the browser handle it normally,
      // don't feed it into game controls.
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      // Space would scroll the page; Ctrl is reverse, so block browser shortcuts like Ctrl+R
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.ctrlKey) e.preventDefault();
      if (!this.down.has(e.code)) this.justPressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(code) { return this.down.has(code); }

  pressed(code) {
    const had = this.justPressed.has(code);
    this.justPressed.delete(code);
    return had;
  }

  endFrame() { this.justPressed.clear(); }
}
