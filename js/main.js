window.addEventListener('load', () => {
  const game = new Game(document.getElementById('game'));
  window.game = game; // handy for tweaking from the browser console
  game.start();
});
