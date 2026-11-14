// No browser right-click menu - this is a game, not a page with text/links to act on.
window.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('load', () => {
  const game = new Game(document.getElementById('game'));
  window.game = game; // handy for tweaking from the browser console
  game.start();
});
