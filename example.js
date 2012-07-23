// example.js
// Run this file to see coffee-streamline's efficient require() in action.
//
// Usage:
// node example

var LABEL = 'Coffee-Streamline require()';

console.time(LABEL);
require('./.');
require('./example._coffee');
console.timeEnd(LABEL);
