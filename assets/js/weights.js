/* MateCheck evaluation weights - written by MateCheck.ipynb (self-play tuning). */
(function (root) {
  var w = {"work": 30, "queen": 60, "muster": 3, "royalEarly": 0.13, "squatted": 1, "noRallier": 2, "check": 1, "tempo": 10, "courtIdle": 1.5};
  if (typeof module === 'object' && module.exports) module.exports = { weights: w };
  else root.MateCheckWeights = w;
}(typeof self !== 'undefined' ? self : this));
